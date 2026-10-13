# The review page's backend: one Windows Consumption (Y1) Function App that embeds hunks (MiniLM, on its
# own CPU) and titles groups (a small Azure OpenAI model, titles_model, pay per token).
#
# Cost guards, all in this file:
# - Consumption plan: billed per execution and GB-s, with a monthly free grant of 400,000 GB-s and
#   1M executions per subscription. Nothing runs, or is billed, between requests.
# - daily_memory_time_quota: the platform stops the app for the rest of the day once it has used this
#   many GB-s. The default (2,000/day, ~62,000/month) costs under $1 even with no free grant left.
#   Only Windows Consumption supports this hard cap, which is why the app is Windows, not Linux/Flex.
# - app_scale_limit = 1: one instance, so a burst of requests queues instead of fanning out.
# - No Application Insights (ingestion is the usual surprise bill); platform logs only.
# - Titles: the function caches answers by prompt in Table storage and stops calling the model once
#   the day's spend reaches titles_daily_budget_usd ($0.025, so at most ~$0.78/month), or a month's
#   spend reaches the organization's or project's cap (titles_caps). The model
#   resource accepts only the function's managed identity (keys disabled), so nothing can bypass that.
# - A $1 monthly budget on the resource group emails you at 50% actual and 100% forecast.

terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

# Derives each organization's service hook secret (backend/src/stacks/hooks.ts). Rotating it breaks
# existing hook subscriptions until a project admin turns auto-restack off and on again.
resource "random_password" "hook_key" {
  length  = 48
  special = false
}

locals {
  name = "${var.name}-${random_string.suffix.result}"
  # backend/build.mjs writes the package's content hash; naming the zip after it redeploys on change.
  package_dir     = "${path.module}/../backend/.build/app"
  package_version = trimspace(file("${path.module}/../backend/.build/version"))
}

resource "azurerm_resource_group" "this" {
  name     = "rg-${local.name}"
  location = var.location
}

# Holds the host's keys/locks and the deployed package. Pennies per month at this traffic.
resource "azurerm_storage_account" "this" {
  name                            = substr(replace("st${local.name}", "-", ""), 0, 24)
  resource_group_name             = azurerm_resource_group.this.name
  location                        = azurerm_resource_group.this.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
}

resource "azurerm_service_plan" "this" {
  name                = "asp-${local.name}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  os_type             = "Windows"
  sku_name            = "Y1"
}

data "archive_file" "package" {
  type        = "zip"
  source_dir  = local.package_dir
  output_path = "${path.module}/.build/backend-${local.package_version}.zip"
}

# Titles are optional: titles_model = null deploys no model, and the page keeps rule-based titles.
resource "azurerm_cognitive_account" "openai" {
  count               = var.titles_model == null ? 0 : 1
  name                = "oai-${local.name}"
  resource_group_name = azurerm_resource_group.this.name
  location            = var.openai_location
  # AI Services hosts both Azure OpenAI models and Foundry models (Phi, grok, ...).
  kind                  = "AIServices"
  sku_name              = "S0"
  custom_subdomain_name = "oai-${local.name}"
  local_auth_enabled    = false
}

resource "azurerm_cognitive_deployment" "titles" {
  count                = var.titles_model == null ? 0 : 1
  name                 = var.titles_model.name
  cognitive_account_id = azurerm_cognitive_account.openai[0].id

  model {
    format  = var.titles_model.format
    name    = var.titles_model.name
    version = var.titles_model.version
  }

  sku {
    name = "GlobalStandard"
    # Thousands of tokens per minute: a rate limit, not a spending cap (the function enforces that).
    capacity = 20
  }
}

resource "azurerm_role_assignment" "titles" {
  count = var.titles_model == null ? 0 : 1
  scope = azurerm_cognitive_account.openai[0].id
  # Inference on every model type in the resource (the OpenAI-only role doesn't cover Foundry models).
  role_definition_name = "Cognitive Services User"
  principal_id         = azurerm_windows_function_app.this.identity[0].principal_id
}

resource "azurerm_windows_function_app" "this" {
  name                        = "func-${local.name}"
  resource_group_name         = azurerm_resource_group.this.name
  location                    = azurerm_resource_group.this.location
  service_plan_id             = azurerm_service_plan.this.id
  storage_account_name        = azurerm_storage_account.this.name
  storage_account_access_key  = azurerm_storage_account.this.primary_access_key
  functions_extension_version = "~4"
  https_only                  = true
  builtin_logging_enabled     = false
  daily_memory_time_quota     = var.daily_gb_seconds_quota
  zip_deploy_file             = data.archive_file.package.output_path

  identity {
    type = "SystemAssigned"
  }

  site_config {
    # onnxruntime-node ships 64-bit binaries only (backend/build.mjs packages win32/x64).
    use_32_bit_worker   = false
    app_scale_limit     = 1
    minimum_tls_version = "1.2"

    application_stack {
      node_version = "~22"
    }

    cors {
      allowed_origins = var.allowed_origins
    }
  }

  app_settings = {
    WEBSITE_RUN_FROM_PACKAGE = "1"
    # Checks the Bearer token the review page gets from SDK.getAppToken() (backend/src/auth.ts).
    EXTENSION_SECRET = var.extension_secret
    # backend/src/titles.ts
    # The OpenAI-compatible v1 API, which serves every model in an AI Services resource.
    OPENAI_ENDPOINT           = var.titles_model == null ? "" : "https://${azurerm_cognitive_account.openai[0].custom_subdomain_name}.openai.azure.com/"
    OPENAI_DEPLOYMENT         = var.titles_model == null ? "" : azurerm_cognitive_deployment.titles[0].name
    TITLES_REASONING_EFFORT   = var.titles_model == null ? "" : var.titles_model.reasoning_effort
    TITLES_DAILY_BUDGET_USD   = tostring(var.titles_daily_budget_usd)
    TITLES_CAPS               = jsonencode(var.titles_caps)
    TITLES_PRICE_INPUT_PER_M  = tostring(var.titles_price_per_million.input)
    TITLES_PRICE_OUTPUT_PER_M = tostring(var.titles_price_per_million.output)
    # backend/src/stacks: auto-restack. Without ADO_PAT, the managed identity calls Azure DevOps and
    # must be added to the organization (see docs/stacks.md).
    HOOK_KEY     = random_password.hook_key.result
    ADO_PAT      = var.ado_pat
    EXTENSION_ID = var.extension_id
  }
}

resource "azurerm_consumption_budget_resource_group" "this" {
  count             = var.alert_email == "" ? 0 : 1
  name              = "budget-${local.name}"
  resource_group_id = azurerm_resource_group.this.id
  amount            = var.monthly_budget
  time_grain        = "Monthly"

  time_period {
    start_date = formatdate("YYYY-MM-01'T'00:00:00Z", timestamp())
  }

  notification {
    threshold      = 50
    threshold_type = "Actual"
    operator       = "GreaterThanOrEqualTo"
    contact_emails = [var.alert_email]
  }

  notification {
    threshold      = 100
    threshold_type = "Forecasted"
    operator       = "GreaterThanOrEqualTo"
    contact_emails = [var.alert_email]
  }

  lifecycle {
    # The start date only matters at creation; don't diff it on every apply.
    ignore_changes = [time_period]
  }
}

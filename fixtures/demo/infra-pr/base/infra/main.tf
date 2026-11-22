# The users API: a function app, with a storage account for avatar uploads and the audit trail.

terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.0"
    }
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "this" {
  name     = "rg-${var.name}"
  location = var.location
}

resource "azurerm_storage_account" "uploads" {
  name                     = "st${var.name}uploads"
  resource_group_name      = azurerm_resource_group.this.name
  location                 = azurerm_resource_group.this.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
}

resource "azurerm_storage_container" "avatars" {
  name                  = "avatars"
  storage_account_id    = azurerm_storage_account.uploads.id
  container_access_type = "private"
}

# Who changed which user, kept for a year.
resource "azurerm_storage_table" "audit" {
  name                 = "audit"
  storage_account_name = azurerm_storage_account.uploads.name
}

resource "azurerm_service_plan" "this" {
  name                = "asp-${var.name}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  os_type             = "Linux"
  sku_name            = "Y1"
}

resource "azurerm_linux_function_app" "api" {
  name                       = "func-${var.name}"
  resource_group_name        = azurerm_resource_group.this.name
  location                   = azurerm_resource_group.this.location
  service_plan_id            = azurerm_service_plan.this.id
  storage_account_name       = azurerm_storage_account.uploads.name
  storage_account_access_key = azurerm_storage_account.uploads.primary_access_key
  https_only                 = true

  site_config {
    application_stack {
      node_version = "20"
    }
  }

  app_settings = {
    AVATAR_CONTAINER = azurerm_storage_container.avatars.name
    AUDIT_TABLE      = azurerm_storage_table.audit.name
  }
}

# Load timings: the review page's wide events (extension/src/app/timings.ts) land in the DeckTimings_CL table of a
# Log Analytics workspace, for Grafana or the portal to query. The page sends them to the function
# (POST /api/timings, backend/src/timings.ts), which writes them through this data collection rule as its managed
# identity. Pages send nothing until an organization administrator turns "Send load timings" on.
#
# Cost guards:
# - load_timings_daily_quota_gb: the workspace stops ingesting for the rest of the UTC day at this size. An event is
#   about 3 KB, so the default 0.1 GB is some 30,000 page loads a day.
# - 30 days of retention, which Analytics tables keep at no charge.
# - Pay-as-you-go ingestion (PerGB2018). The first 5 GB a month of each billing account are free, then about
#   $2.30/GB; check the Azure Monitor pricing page for your region.

locals {
  timings_table  = "DeckTimings_CL"
  timings_stream = "Custom-${local.timings_table}"
  # The table's and the rule's columns. Grafana filters on these; the rest of the event is in Event.
  timings_columns = [
    { name = "TimeGenerated", type = "datetime", description = "When the trace started, by the browser's clock." },
    { name = "Kind", type = "string", description = "load (the page opened) or navigate (a move inside it)." },
    { name = "Outcome", type = "string", description = "settled, error, timeout, left or off." },
    { name = "View", type = "string", description = "pr, hub, settings, org-settings or changelog." },
    { name = "Organization", type = "string", description = "Azure DevOps organization." },
    { name = "ProjectId", type = "string", description = "Azure DevOps project id." },
    { name = "Version", type = "string", description = "Review Deck extension version." },
    { name = "Browser", type = "string", description = "Browser and major version." },
    { name = "TotalMs", type = "int", description = "From the trace's start until it ended." },
    { name = "Event", type = "dynamic", description = "The whole event: steps, context, REST calls, assets, frame." },
  ]
}

resource "azurerm_log_analytics_workspace" "timings" {
  count               = var.load_timings ? 1 : 0
  name                = "log-${local.name}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = var.load_timings_daily_quota_gb
}

resource "azurerm_log_analytics_workspace_table_custom_log" "timings" {
  count             = var.load_timings ? 1 : 0
  name              = local.timings_table
  workspace_id      = azurerm_log_analytics_workspace.timings[0].id
  plan              = "Analytics"
  retention_in_days = 30

  dynamic "column" {
    for_each = local.timings_columns
    content {
      name = column.value.name
      # The table spells it dateTime, the rule's stream datetime.
      type        = column.value.type == "datetime" ? "dateTime" : column.value.type
      description = column.value.description
    }
  }
}

# Where the Logs Ingestion API is reached; the function posts to it (TIMINGS_INGESTION_ENDPOINT).
resource "azurerm_monitor_data_collection_endpoint" "timings" {
  count               = var.load_timings ? 1 : 0
  name                = "dce-${local.name}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
}

resource "azurerm_monitor_data_collection_rule" "timings" {
  count                       = var.load_timings ? 1 : 0
  name                        = "dcr-${local.name}-timings"
  resource_group_name         = azurerm_resource_group.this.name
  location                    = azurerm_resource_group.this.location
  data_collection_endpoint_id = azurerm_monitor_data_collection_endpoint.timings[0].id

  stream_declaration {
    stream_name = local.timings_stream
    dynamic "column" {
      for_each = local.timings_columns
      content {
        name = column.value.name
        type = column.value.type
      }
    }
  }

  destinations {
    log_analytics {
      name                  = "workspace"
      workspace_resource_id = azurerm_log_analytics_workspace.timings[0].id
    }
  }

  data_flow {
    streams       = [local.timings_stream]
    destinations  = ["workspace"]
    output_stream = local.timings_stream
    transform_kql = "source"
  }

  # The rule can only send to a table that exists.
  depends_on = [azurerm_log_analytics_workspace_table_custom_log.timings]
}

# The function's only right here: sending rows through this rule.
resource "azurerm_role_assignment" "timings_writer" {
  count                = var.load_timings ? 1 : 0
  scope                = azurerm_monitor_data_collection_rule.timings[0].id
  role_definition_name = "Monitoring Metrics Publisher"
  principal_id         = azurerm_windows_function_app.this.identity[0].principal_id
}

# Grafana's identity (its managed identity, or the app registration its Azure Monitor data source signs in as).
resource "azurerm_role_assignment" "timings_reader" {
  for_each             = var.load_timings ? toset(var.load_timings_readers) : toset([])
  scope                = azurerm_log_analytics_workspace.timings[0].id
  role_definition_name = "Log Analytics Reader"
  principal_id         = each.value
}

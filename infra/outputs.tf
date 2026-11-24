output "backend_url" {
  description = "Base URL of the backend: enter it in Project settings > Review Deck > Backend."
  value       = "https://${azurerm_windows_function_app.this.default_hostname}"
}

output "api_key" {
  description = "The key to enter with backend_url (terraform output -raw api_key)."
  value       = random_password.api_key.result
  sensitive   = true
}

output "resource_group" {
  value = azurerm_resource_group.this.name
}

output "restack_identity" {
  description = "The managed identity auto-restack acts as. Add it to your Azure DevOps organization (Organization settings > Users, as a service principal) unless you set ado_pat."
  value = {
    principal_id = azurerm_windows_function_app.this.identity[0].principal_id
    name         = azurerm_windows_function_app.this.name
  }
}

output "timings_workspace" {
  description = "The Log Analytics workspace load timings go to (table DeckTimings_CL), for Grafana's Azure Monitor data source. Null with load_timings = false."
  value = var.load_timings ? {
    resource_id  = azurerm_log_analytics_workspace.timings[0].id
    workspace_id = azurerm_log_analytics_workspace.timings[0].workspace_id
    name         = azurerm_log_analytics_workspace.timings[0].name
  } : null
}

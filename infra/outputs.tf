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

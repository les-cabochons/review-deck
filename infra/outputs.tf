output "backend_url" {
  description = "Base URL of the backend: build the extension with SEMANTIC_PR_BACKEND_URL set to this."
  value       = "https://${azurerm_windows_function_app.this.default_hostname}"
}

output "resource_group" {
  value = azurerm_resource_group.this.name
}

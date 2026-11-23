output "account_name" {
  value = azurerm_storage_account.this.name
}

output "queue_name" {
  value = azurerm_storage_queue.resize.name
}

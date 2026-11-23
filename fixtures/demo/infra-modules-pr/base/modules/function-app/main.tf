resource "azurerm_service_plan" "this" {
  name                = "plan-${var.name}"
  resource_group_name = "rg-${var.name}"
  location            = var.location
  os_type             = "Linux"
  sku_name            = "Y1"
}

resource "azurerm_linux_function_app" "this" {
  name                       = var.name
  resource_group_name        = "rg-${var.name}"
  location                   = var.location
  service_plan_id            = azurerm_service_plan.this.id
  storage_account_name       = var.storage_account_name
  virtual_network_subnet_id  = var.subnet_id

  site_config {}

  app_settings = {
    AVATAR_CONTAINER = "avatars"
  }
}

output "hostname" {
  value = azurerm_linux_function_app.this.default_hostname
}

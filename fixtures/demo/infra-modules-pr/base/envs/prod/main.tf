module "naming" {
  source  = "Azure/naming/azurerm"
  version = "0.4.1"
  suffix  = ["avatars", "prod"]
}

module "network" {
  source   = "../../modules/network"
  location = var.location
}

module "storage" {
  source   = "../../modules/storage"
  name     = module.naming.storage_account.name_unique
  location = var.location
}

module "function_app" {
  source               = "../../modules/function-app"
  name                 = module.naming.function_app.name
  location             = var.location
  storage_account_name = module.storage.account_name
  subnet_id            = module.network.app_subnet_id
}

output "hostname" {
  value = module.function_app.hostname
}

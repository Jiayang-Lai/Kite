output "tenant_id" {
  description = "Microsoft Entra tenant ID to enter in Kite."
  value       = data.azuread_client_config.current.tenant_id
}

output "log_analytics_workspace_id" {
  description = "Log Analytics workspace (customer) ID to enter in Kite."
  value       = azurerm_log_analytics_workspace.kite.workspace_id
}

output "log_analytics_workspace_resource_id" {
  description = "Azure resource ID of the Log Analytics workspace."
  value       = azurerm_log_analytics_workspace.kite.id
}

output "secondary_log_analytics_workspace_id" {
  description = "Second Log Analytics workspace (customer) ID for testing Kite cluster editing and switching."
  value       = azurerm_log_analytics_workspace.kite_secondary.workspace_id
}

output "secondary_log_analytics_workspace_resource_id" {
  description = "Azure resource ID of the second Log Analytics workspace."
  value       = azurerm_log_analytics_workspace.kite_secondary.id
}

output "kite_test_logs_ingestion_endpoint" {
  description = "Logs Ingestion API endpoint for the Kite test table."
  value       = azurerm_monitor_data_collection_endpoint.kite_test.logs_ingestion_endpoint
}

output "kite_test_logs_dcr_immutable_id" {
  description = "Immutable ID to include when ingesting records through the Kite test DCR."
  value       = azurerm_monitor_data_collection_rule.kite_test.immutable_id
}

output "kite_test_logs_input_stream" {
  description = "Logs Ingestion API stream name accepted by the Kite test DCR."
  value       = "Custom-KiteTestInput"
}

output "application_client_id" {
  description = "Public Microsoft Entra application/client ID to enter in Kite."
  value       = azuread_application.kite_log_analytics.client_id
}

output "application_object_id" {
  description = "Microsoft Entra application object ID."
  value       = azuread_application.kite_log_analytics.object_id
}

output "service_principal_object_id" {
  description = "Microsoft Entra enterprise application object ID. Not used by Kite's browser-only delegated flow."
  value       = azuread_service_principal.kite_log_analytics.object_id
}

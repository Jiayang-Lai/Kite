data "azuread_client_config" "current" {}

locals {
  # Microsoft-owned, globally stable identifiers for the Log Analytics API and
  # its delegated Data.Read scope. Avoid a tenant-local service-principal data
  # lookup: that enterprise application might not yet exist in a new tenant.
  log_analytics_api_application_id = "ca7f3f0b-7d91-482c-8e09-c5d840d0eac5"
  log_analytics_data_read_scope_id = "e8dac03d-d467-4a7e-9293-9cca7df08b31"
}

resource "azurerm_resource_group" "kite" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

resource "azurerm_log_analytics_workspace" "kite" {
  name                = var.workspace_name
  location            = azurerm_resource_group.kite.location
  resource_group_name = azurerm_resource_group.kite.name
  sku                 = "PerGB2018"
  retention_in_days   = var.retention_in_days

  # Kite always uses Entra tokens; do not create reusable workspace shared keys.
  local_authentication_enabled    = false
  allow_resource_only_permissions = false
  internet_ingestion_enabled      = var.internet_ingestion_enabled
  internet_query_enabled          = var.internet_query_enabled
  daily_quota_gb                  = var.daily_quota_gb
  tags                            = var.tags
}

# A separate workspace lets Kite exercise cluster editing and switching without
# changing the primary workspace or its test-ingestion setup.
resource "azurerm_log_analytics_workspace" "kite_secondary" {
  name                = var.secondary_workspace_name
  location            = azurerm_resource_group.kite.location
  resource_group_name = azurerm_resource_group.kite.name
  sku                 = "PerGB2018"
  retention_in_days   = var.retention_in_days

  local_authentication_enabled    = false
  allow_resource_only_permissions = false
  internet_ingestion_enabled      = var.internet_ingestion_enabled
  internet_query_enabled          = var.internet_query_enabled
  daily_quota_gb                  = var.daily_quota_gb
  tags                            = var.tags
}

# A custom table for exercising every primitive type supported by Logs Ingestion
# API stream declarations. Custom Log Analytics table names must end in `_CL`.
resource "azurerm_log_analytics_workspace_table_custom_log" "kite_test" {
  name         = "KiteTest_CL"
  workspace_id = azurerm_log_analytics_workspace.kite.id

  column {
    name = "TimeGenerated"
    type = "dateTime"
  }

  column {
    name = "BooleanValue"
    type = "boolean"
  }

  column {
    name = "DynamicValue"
    type = "dynamic"
  }

  column {
    name = "GuidValue"
    type = "string"
  }

  column {
    name = "IntValue"
    type = "int"
  }

  column {
    name = "LongValue"
    type = "long"
  }

  column {
    name = "RealValue"
    type = "real"
  }

  column {
    name = "StringValue"
    type = "string"
  }
}

# The Logs Ingestion API posts to this endpoint. It stays in the workspace's
# region, as required by Azure Monitor.
resource "azurerm_monitor_data_collection_endpoint" "kite_test" {
  name                = "kite-test-logs-dce"
  resource_group_name = azurerm_resource_group.kite.name
  location            = azurerm_resource_group.kite.location
  description         = "Logs Ingestion API endpoint for KiteTest_CL."
  tags                = var.tags
}

# This DCR accepts a record matching the test-table schema and sends it
# unchanged to KiteTest_CL through the Logs Ingestion API. GUIDs are represented
# as strings because DCR stream declarations do not support `guid`.
resource "azurerm_monitor_data_collection_rule" "kite_test" {
  name                        = "kite-test-logs-dcr"
  resource_group_name         = azurerm_resource_group.kite.name
  location                    = azurerm_resource_group.kite.location
  data_collection_endpoint_id = azurerm_monitor_data_collection_endpoint.kite_test.id
  description                 = "Routes test log records to KiteTest_CL."
  tags                        = var.tags

  destinations {
    log_analytics {
      workspace_resource_id = azurerm_log_analytics_workspace.kite.id
      name                  = "kiteTestWorkspace"
    }
  }

  data_flow {
    streams       = ["Custom-KiteTestInput"]
    destinations  = ["kiteTestWorkspace"]
    transform_kql = "source"
    output_stream = "Custom-KiteTest_CL"
  }

  stream_declaration {
    stream_name = "Custom-KiteTestInput"

    column {
      name = "TimeGenerated"
      type = "datetime"
    }

    column {
      name = "BooleanValue"
      type = "boolean"
    }

    column {
      name = "DynamicValue"
      type = "dynamic"
    }

    column {
      name = "GuidValue"
      type = "string"
    }

    column {
      name = "IntValue"
      type = "int"
    }

    column {
      name = "LongValue"
      type = "long"
    }

    column {
      name = "RealValue"
      type = "real"
    }

    column {
      name = "StringValue"
      type = "string"
    }
  }

  depends_on = [azurerm_log_analytics_workspace_table_custom_log.kite_test]
}

# The Logs Ingestion API requires this role on the DCR for each client identity
# that will submit records. Keep it empty when access is managed elsewhere.
resource "azurerm_role_assignment" "kite_test_log_ingestors" {
  for_each = toset(var.test_log_ingestor_principal_ids)

  scope                = azurerm_monitor_data_collection_rule.kite_test.id
  role_definition_name = "Monitoring Metrics Publisher"
  principal_id         = each.value
}

resource "azuread_application" "kite_log_analytics" {
  display_name            = var.application_display_name
  description             = "Browser-only Microsoft Entra application used by Kite to query Azure Log Analytics."
  sign_in_audience        = "AzureADMyOrg"
  prevent_duplicate_names = true
  owners                  = setunion(toset([data.azuread_client_config.current.object_id]), var.application_owner_object_ids)

  single_page_application {
    # AzureAD requires a root URL to include its trailing slash. Register both
    # that root URL and Kite's dedicated MSAL popup callback for every origin.
    redirect_uris = toset(flatten([
      for uri in var.spa_redirect_uris : [
        endswith(uri, "/") ? uri : "${uri}/",
        "${trimsuffix(uri, "/")}/auth/callback"
      ]
    ]))
  }

  # Lets Kite pass a selected MSAL account to Entra's logout endpoint without
  # showing the account picker when the account has an active browser session.
  optional_claims {
    id_token {
      name = "login_hint"
    }
  }

  required_resource_access {
    resource_app_id = local.log_analytics_api_application_id

    resource_access {
      id   = local.log_analytics_data_read_scope_id
      type = "Scope"
    }
  }
}

# The service principal is created explicitly so operators can grant it access
# later for a separate, server-side client-credentials integration. Kite's
# browser-only flow uses the signed-in user's permissions instead.
resource "azuread_service_principal" "kite_log_analytics" {
  client_id = azuread_application.kite_log_analytics.client_id
  owners    = setunion(toset([data.azuread_client_config.current.object_id]), var.application_owner_object_ids)
}

# For browser-only Kite, provide user or group object IDs here. A service
# principal object ID is accepted only for a future non-browser integration.
resource "azurerm_role_assignment" "workspace_log_readers" {
  for_each = toset(var.workspace_log_reader_principal_ids)

  scope                = azurerm_log_analytics_workspace.kite.id
  role_definition_name = "Log Analytics Data Reader"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "secondary_workspace_log_readers" {
  for_each = toset(var.workspace_log_reader_principal_ids)

  scope                = azurerm_log_analytics_workspace.kite_secondary.id
  role_definition_name = "Log Analytics Data Reader"
  principal_id         = each.value
}

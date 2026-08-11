# Azure Log Analytics and Entra infrastructure

This Terraform root creates:

- a resource group and two Log Analytics workspaces; the second is for testing Kite cluster editing and switching;
- a `KiteTest_CL` custom table covering all primitive types supported by Logs Ingestion API stream declarations: `dateTime`, `boolean`, `dynamic`, `int`, `long`, `real`, and `string` (GUIDs are represented as strings);
- a Data Collection Endpoint and direct Data Collection Rule (DCR) that route `Custom-KiteTestInput` records to `KiteTest_CL` through the Logs Ingestion API;
- a single-tenant Microsoft Entra application registration configured as a SPA;
- the `Log Analytics API` delegated `Data.Read` permission request;
- its enterprise application (service principal); and
- optional workspace-scoped `Log Analytics Reader` assignments.

It is designed for Kite's browser-only authorization-code-with-PKCE flow. It deliberately creates **no client secret**, certificate, API key, or application permission. Browser users authenticate as themselves, so assign workspace access to Entra users or groups, not to the Kite enterprise application.

## Prerequisites and Terraform identity

Use an Azure identity that can create resource groups, workspaces, Data Collection Endpoints, and DCRs in the target subscription; create Entra applications; read the `Log Analytics API` enterprise application; and assign roles at workspace and DCR scope. In practice, the IaC runner commonly needs Contributor plus User Access Administrator (or Owner) on the target subscription, and Application Administrator (or equivalent Microsoft Graph permissions) in Entra.

Authenticate with Azure CLI before running Terraform:

```bash
az login
az account set --subscription "<subscription-id>"
```

Use an encrypted remote state backend with locking before applying. A starting `backend.tf.example` for an Azure Storage backend is included; copy it to `backend.tf` and replace its placeholders. State includes resource identifiers but no credentials with this configuration. Do not commit local state, plans, or `terraform.tfvars`.

## Configure and apply

```bash
cd infra/azure
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

Replace the placeholder principal ID in `workspace_log_reader_principal_ids` with an Entra user or, preferably, Entra security-group object ID. Remove the example entry completely if role assignments are managed elsewhere.

Every Kite origin must be included in `spa_redirect_uris`, including local development and preview origins. Hosted entries must use HTTPS; HTTP is accepted only for local development, such as `http://localhost:5173`, `http://127.0.0.1:5173`, or `http://[::1]:5173`. A trailing slash is optional in the input; Terraform registers each root URL with the slash required by the AzureAD provider and its `/auth/callback` URL used to complete MSAL popup authentication. They are SPA redirect URIs; do not use a `Web` redirect URI or a client secret.

## Consent and RBAC

The app registration declares the delegated **Log Analytics API / Data.Read** permission and requests the optional `login_hint` ID-token claim. Kite uses that claim to target the selected account when opening Microsoft Entra's sign-out page. Terraform declares the permission request but does not grant tenant-wide admin consent, because that choice is tenant policy and can authorize use more broadly than the intended users. Have an Entra administrator grant consent if users cannot consent themselves.

The configuration uses Microsoft-owned, globally stable application and delegated-scope IDs for Log Analytics. It intentionally does not look up the tenant-local **Log Analytics API** enterprise application, because that service principal might not exist in a new tenant before a user or administrator first consents to it.

Workspace RBAC is independent from Entra consent. This root can assign `Log Analytics Reader` to the object IDs in `workspace_log_reader_principal_ids`. For more restrictive access, leave that variable empty and manage a custom or table-level role separately. New RBAC assignments can take several minutes to reach the Logs Query API.

After applying, retrieve the connection values without exposing any secret:

```bash
terraform output tenant_id
terraform output application_client_id
terraform output log_analytics_workspace_id
terraform output secondary_log_analytics_workspace_id
```

Use the primary and secondary workspace IDs to create two Azure Log Analytics connections in Kite, then test editing and switching between them. Both receive the same `Log Analytics Reader` assignments configured in `workspace_log_reader_principal_ids`; the test table and ingestion DCR remain on the primary workspace.

## Ingesting test logs

The DCR accepts JSON records on the `Custom-KiteTestInput` stream whose fields match the `KiteTest_CL` columns. The `GuidValue` input is a string because DCR stream declarations don't support `guid`. The DCR passes records through unchanged to the table.

Generate a medium-sized, ready-to-ingest JSON array with the included script:

```bash
node infra/azure/scripts/generate-kite-test-logs.mjs
```

It writes 500 records to `infra/azure/samples/kite-test-logs.json` by default. Use `--count` or `--output` to change the quantity or destination, for example:

```bash
node infra/azure/scripts/generate-kite-test-logs.mjs --count 1000 --output /tmp/kite-test-logs.json
```

To post the generated file, sign in to the Azure CLI with an identity that has the DCR's `Monitoring Metrics Publisher` role, then run:

```bash
node infra/azure/scripts/post-kite-test-logs.mjs \
  --endpoint "$(terraform -chdir=infra/azure output -raw kite_test_logs_ingestion_endpoint)" \
  --dcr-immutable-id "$(terraform -chdir=infra/azure output -raw kite_test_logs_dcr_immutable_id)"
```

The script sends `samples/kite-test-logs.json` to `Custom-KiteTestInput` by default. Override either with `--file` or `--stream` when needed.

Use the `kite_test_logs_ingestion_endpoint` and `kite_test_logs_dcr_immutable_id` outputs in a Logs Ingestion API client.

```bash
terraform output kite_test_logs_ingestion_endpoint
terraform output kite_test_logs_dcr_immutable_id
terraform output kite_test_logs_input_stream
```

The client identity must have the `Monitoring Metrics Publisher` role on the DCR. Set `test_log_ingestor_principal_ids` to the object ID of each service principal or managed identity that should ingest test records. This root does not create a client secret; use a managed identity or manage a credential for a dedicated ingestion app outside this Terraform configuration.

## Operational notes

- `local_authentication_enabled = false` prevents use of workspace shared keys; Kite uses Microsoft Entra tokens only.
- `internet_query_enabled` must be true for Kite to query the Logs API directly from a browser. Private-only workspace access requires a future server-side proxy design.
- Destroying this root deletes the workspace and its retained data. Use a reviewed plan and a protected remote state backend in production.

# Azure authentication terminology

Kite uses these terms consistently.

| Term | Meaning |
| --- | --- |
| Azure authentication profile | Kite's browser-local reusable configuration: its name, Microsoft Entra tenant, application client ID, and remembered MSAL account binding. It contains no tokens or secrets. |
| Analytics connection | The Log Analytics workspace configuration. It links to an Azure authentication profile through `authenticationProfileId`. |
| MSAL client | The MSAL application instance for a tenant and application client ID pair. |
| MSAL account | An MSAL `AccountInfo` identity record. |
| Microsoft Entra browser session | The upstream Entra/SSO browser session; this is the only context in which the unqualified word “session” is used. |
| Access token | A short-lived token acquired by MSAL for the Log Analytics API. |

An authentication profile is not proof of a live login. Kite considers a profile signed in only when its MSAL account can be resolved and a usable access token can be acquired.

Removing an authentication profile removes Kite's local configuration only. **Clear Kite sign-in** clears the remembered account binding for all profiles representing the same Entra account and clears relevant MSAL caches. **Sign out** also opens Microsoft Entra's server sign-out page in a popup for the selected MSAL account.

# Table schema JSON and CSV ingestion quick start

This walkthrough creates a `DeviceNetworkEvents` table in Kite's browser-based **Emulated cluster**, imports its schema from a table schema JSON file, and ingests a public CSV sample. No Kusto server, account, or container is required.

## What you need

- A running Kite app (use the hosted app or follow the [local setup](../README.md#run-locally)).
- The included [DeviceNetworkEvents.avsc](../samples/DeviceNetworkEvents.avsc) table schema JSON file. Download it locally if you are using the hosted app.

The data source used below is:

```text
https://raw.githubusercontent.com/Jiayang-Lai/100-Days-of-KQL/refs/heads/main/samples/DemoDeviceNetworkEvents.csv
```

## 1. Select the emulated cluster

1. Open Kite and select **Emulated cluster** from the cluster selector.
2. Wait for the `memory` database to appear in the explorer.

The built-in emulated cluster is ephemeral: its tables and data are cleared on a full page reload. Create a custom persistent emulated cluster if you want the data to survive reloads.

## 2. Create the table from a schema JSON file

1. Go to **Admin → Databases & tables**.
2. Keep `memory` selected, or create and select another database.
3. Select **New table**.
4. Select **Import JSON template** and choose `DeviceNetworkEvents.avsc`.
5. Confirm that the table name is `DeviceNetworkEvents` and that 49 columns were imported.
6. Select **Review table**, enter `CREATE DeviceNetworkEvents`, then select **Create table**.

The imported fields remain editable before creation. The sample is a table schema JSON file; Kite maps its field types to Kusto column types.

## 3. Ingest the CSV sample

1. Go to **Admin → Data ingestion**.
2. Select the database and the `DeviceNetworkEvents` table.
3. Open the **Remote file** tab.
4. Paste the CSV URL shown above.
5. Set **Format** to **CSV** and enable **Skip first line**.
6. Select **Review ingestion**, type `RUN`, then select **Ingest data**.

The remote file must allow browser CORS and range requests. The GitHub raw URL above supports this. Ingestion appends rows, so repeating the action adds the same rows again.

## 4. Query the data

Open **Query workspace** and run:

```kusto
DeviceNetworkEvents
| take 10
```

If the table was just created while the editor was open, Kite refreshes the IntelliSense schema automatically. If you have selected another database, select the database containing the table before running the unqualified query.

## CSV column order matters

CSV ingestion is positional: Kite's emulated cluster assigns each CSV value to the table column at the same ordinal position. The included table schema JSON file has exactly the same 49 fields, names, and order as the sample CSV header. Keep that order when adapting this example, or use an ingestion mapping for a remote Kusto cluster.

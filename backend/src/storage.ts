import { TableClient } from "@azure/data-tables";

const tables = new Map<string, Promise<TableClient>>();

/** Tables in the Function App's own storage account, created on first use. */
export function table(name: string): Promise<TableClient> {
  let client = tables.get(name);
  if (!client) {
    const connection = process.env.AzureWebJobsStorage;
    if (!connection) throw new Error("AzureWebJobsStorage is not set");
    // Local runs use Azurite over plain HTTP; Azure storage is always HTTPS.
    const local = connection.includes("UseDevelopmentStorage=true") || connection.includes("DefaultEndpointsProtocol=http;");
    const c = TableClient.fromConnectionString(connection, name, { allowInsecureConnection: local });
    client = c.createTable().then(() => c);
    client.catch(() => tables.delete(name));
    tables.set(name, client);
  }
  return client;
}

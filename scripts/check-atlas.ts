import { MongoClient } from 'mongodb';

// This probe never calls Store.connect(): that method creates indexes.
// Keep connection diagnostics read-only and never log a URI or driver message.
async function main() {
  const uri = process.env.MONGODB_URI ?? '';
  const database = process.env.DB_NAME ?? '';
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error('Complete MONGODB_URI in the private .env.atlas file.');
  }
  if (
    url.protocol !== 'mongodb+srv:' ||
    !url.hostname.endsWith('.mongodb.net') ||
    !url.username ||
    !url.password ||
    /REPLACE_WITH|<|>/i.test(decodeURIComponent(uri))
  )
    throw new Error('An Atlas SRV URI with real database credentials is required.');
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(database) || /^(admin|local|config)$/i.test(database))
    throw new Error('DB_NAME must name the dedicated application database.');
  if (url.pathname !== '/' && url.pathname !== '' && url.pathname !== `/${database}`)
    throw new Error('The URI database must match DB_NAME, or omit the URI database path.');
  for (const [key, value] of url.searchParams) {
    const normalized = key.toLowerCase();
    if (normalized === 'w' && value !== 'majority')
      throw new Error('Atlas w must be majority. Check the final y in w=majority.');
    if (
      (['tls', 'ssl'].includes(normalized) && value.toLowerCase() !== 'true') ||
      (['tlsinsecure', 'tlsallowinvalidcertificates', 'tlsallowinvalidhostnames'].includes(
        normalized,
      ) &&
        value.toLowerCase() !== 'false')
    )
      throw new Error('TLS and certificate verification must remain enabled.');
  }
  const client = new MongoClient(uri, {
    appName: 'fabrica-credito-atlas-readiness',
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    maxPoolSize: 1,
  });
  try {
    await client.connect();
    for (const name of [database, `${database}_mocks`]) {
      const db = client.db(name);
      await db.command({ ping: 1 });
      await db.listCollections({}, { nameOnly: true }).toArray();
    }
    console.log(
      'Atlas connection, authentication and collection listing: PASS for both databases.',
    );
    console.log('Read-only check: no data, indexes, users or network rules were changed.');
    console.log(
      'Write permissions, seed, AWS connectivity and application flow still need verification.',
    );
  } catch {
    throw new Error(
      'Atlas check failed. Review the URI, database permissions, IP access list and DNS/TLS.',
    );
  } finally {
    await client.close();
  }
}

try {
  await main();
} catch (error) {
  // Only our fixed diagnostics are emitted; never print raw MongoDB errors.
  const messages = new Set([
    'Complete MONGODB_URI in the private .env.atlas file.',
    'An Atlas SRV URI with real database credentials is required.',
    'DB_NAME must name the dedicated application database.',
    'The URI database must match DB_NAME, or omit the URI database path.',
    'TLS and certificate verification must remain enabled.',
    'Atlas w must be majority. Check the final y in w=majority.',
    'Atlas check failed. Review the URI, database permissions, IP access list and DNS/TLS.',
  ]);
  console.error(
    error instanceof Error && messages.has(error.message)
      ? error.message
      : 'Atlas configuration check failed. No credentials were logged.',
  );
  process.exitCode = 1;
}

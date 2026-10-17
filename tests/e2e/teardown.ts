import { readFile, unlink } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
export default async function teardown(){
  const path='artifacts/e2e/runtime.json';
  let raw:string;try{raw=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  const {dbName}=JSON.parse(raw) as {dbName:string};
  if(!/^credito_e2e_[a-f0-9]{32}$/.test(dbName))throw new Error('Refusing to clean an unrecognized test database');
  const client=new MongoClient(process.env.TEST_MONGODB_URI??'mongodb://127.0.0.1:27027');await client.connect();
  try {await client.db(dbName).dropDatabase();await client.db(`${dbName}_mocks`).dropDatabase();}finally{await client.close();await unlink(path);}
}

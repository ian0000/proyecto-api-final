import { MongoClient, type Collection } from 'mongodb';
import type { Application, Actor } from '../../shared/domain.js';
export interface User extends Actor {
  _id: string;
  email: string;
  passwordHash: string;
}
export interface Circuit {
  _id: string;
  failures: number;
  openUntil: Date;
}
export class Store {
  client: MongoClient;
  applications: Collection<Application>;
  users: Collection<User>;
  circuits: Collection<Circuit>;
  constructor(url: string, dbName: string) {
    this.client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
    const db = this.client.db(dbName);
    this.applications = db.collection<Application>('applications');
    this.users = db.collection<User>('users');
    this.circuits = db.collection<Circuit>('circuits');
  }
  async connect() {
    await this.client.connect();
    await Promise.all([
      this.applications.createIndex({ owner: 1, idempotencyKey: 1 }, { unique: true }),
      this.applications.createIndex({ agency: 1, createdAt: -1, _id: -1 }),
      this.applications.createIndex({ state: 1, createdAt: -1 }),
      this.users.createIndex({ email: 1 }, { unique: true }),
      ...['pichincha', 'pacifico'].map((b) =>
        this.applications.createIndex({
          [`submissions.${b}.job.state`]: 1,
          [`submissions.${b}.job.dueAt`]: 1,
        }),
      ),
    ]);
  }
  async close() {
    await this.client.close();
  }
}

import dotenv from "dotenv";
import path from "path";
import { MongoClient } from "mongodb";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is missing!");
}

const client = new MongoClient(uri);

export async function connectToDatabase() {
  // await client.connect();
  return client.db("qr_menu_db");
}

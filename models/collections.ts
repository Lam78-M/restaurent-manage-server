import type { Db } from "mongodb";

export function getCollections(db: Db) {
  return {
    menuCollection: db.collection("add-menu"),
    confirmedCollection: db.collection("confirmed-item"),
    billRequestsCollection: db.collection("bill-requests"),
    invoicesCollection: db.collection("invoices"),
    tablesCollection: db.collection("restaurant-tables"),
    sessionsCollection: db.collection("dining-sessions"),
  };
}

export type Collections = ReturnType<typeof getCollections>;

export async function ensureTablesInitialized(tablesCollection: any) {
  try {
    const count = await tablesCollection.countDocuments();
    if (count === 0) {
      const initialTables = Array.from({ length: 10 }, (_, i) => {
        const tableNo = (i + 1).toString().padStart(2, "0");
        return {
          tableNo,
          capacity: i < 4 ? 2 : i < 8 ? 4 : 6,
          status: "Available", // Available, Occupied, Cooking, Bill Requested, Payment Pending
          currentSessionId: null,
          currentGuestId: null,
          lastUpdated: new Date(),
        };
      });
      await tablesCollection.insertMany(initialTables);
      console.log("Initialized 10 restaurant dining tables.");
    }
  } catch (err) {
    console.error("Error initializing tables:", err);
  }
}

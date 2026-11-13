import { Router } from "express";
import { ObjectId } from "mongodb";
import type { Collections } from "../models/collections";

export function createMenuRoutes(collections: Collections) {
  const { menuCollection } = collections;
  const router = Router();

  // ==========================================
  // 1. MENU ITEMS MANAGEMENT ROUTES
  // ==========================================

  // GET all menu items
  router.get("/api/menu-items", async (req, res) => {
    try {
      const items = await menuCollection.find({}).sort({ createdAt: -1 }).toArray();
      res.status(200).json({ success: true, data: items });
    } catch (error) {
      console.error("Error fetching menu items:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // POST: Add new menu item
  router.post("/api/menu-items", async (req, res) => {
    try {
      const itemData = req.body;
      if (!itemData.name || !itemData.price) {
        return res.status(400).json({ success: false, message: "Item name and price are required." });
      }

      const newMenuItem = {
        name: itemData.name,
        description: itemData.description || "",
        category: itemData.category || "General",
        price: parseFloat(itemData.price),
        discountPrice: itemData.discountPrice ? parseFloat(itemData.discountPrice) : null,
        preparationTime: itemData.preparationTime ? parseInt(itemData.preparationTime) : 15,
        foodType: itemData.foodType || "Non-Veg",
        availability: itemData.availability || "Available",
        featured: Boolean(itemData.featured),
        imageUrl: itemData.imageUrl || "",
        createdAt: new Date(),
      };

      const result = await menuCollection.insertOne(newMenuItem);

      res.status(201).json({
        success: true,
        message: "Menu item successfully added to add-menu collection!",
        insertedId: result.insertedId,
      });
    } catch (error) {
      console.error("Error inserting menu item:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // PUT: Update menu item
  router.put("/api/menu-items/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const itemData = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid item ID." });
      }

      const updatedData: any = {};
      if (itemData.name !== undefined) updatedData.name = itemData.name;
      if (itemData.description !== undefined) updatedData.description = itemData.description;
      if (itemData.category !== undefined) updatedData.category = itemData.category;
      if (itemData.price !== undefined) updatedData.price = parseFloat(itemData.price);
      if (itemData.discountPrice !== undefined) {
        updatedData.discountPrice = itemData.discountPrice ? parseFloat(itemData.discountPrice) : null;
      }
      if (itemData.preparationTime !== undefined) {
        updatedData.preparationTime = itemData.preparationTime ? parseInt(itemData.preparationTime) : null;
      }
      if (itemData.foodType !== undefined) updatedData.foodType = itemData.foodType;
      if (itemData.availability !== undefined) updatedData.availability = itemData.availability;
      if (itemData.featured !== undefined) updatedData.featured = Boolean(itemData.featured);
      if (itemData.imageUrl !== undefined) updatedData.imageUrl = itemData.imageUrl;
      updatedData.updatedAt = new Date();

      const result = await menuCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, message: "Item not found" });
      }

      res.status(200).json({ success: true, message: "Menu item updated successfully!" });
    } catch (error) {
      console.error("Error updating menu item:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // DELETE: Delete menu item
  router.delete("/api/menu-items/:id", async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid item ID." });
      }

      const result = await menuCollection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, message: "Item not found" });
      }

      res.status(200).json({ success: true, message: "Item deleted successfully" });
    } catch (error) {
      console.error("Error deleting menu item:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });


  return router;
}

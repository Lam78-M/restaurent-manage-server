import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { MongoClient, ObjectId } from "mongodb";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is missing!");
}

const client = new MongoClient(uri);
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Helper function to initialize default tables 1-10
async function ensureTablesInitialized(tablesCollection: any) {
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

async function startServer() {
  try {
    await client.connect();

    const db = client.db("qr_menu_db");
    const menuCollection = db.collection("add-menu");
    const confirmedCollection = db.collection("confirmed-item");
    const billRequestsCollection = db.collection("bill-requests");
    const invoicesCollection = db.collection("invoices");
    const tablesCollection = db.collection("restaurant-tables");
    const sessionsCollection = db.collection("dining-sessions");

    await ensureTablesInitialized(tablesCollection);

    console.log("Successfully connected to MongoDB!");

    app.get("/", (req, res) => {
      res.json({
        success: true,
        message: "Restaurant QR Digital Menu & Order Management System API is live!",
        timestamp: new Date(),
      });
    });

    // ==========================================
    // 1. MENU ITEMS MANAGEMENT ROUTES
    // ==========================================

    // GET all menu items
    app.get("/api/menu-items", async (req, res) => {
      try {
        const items = await menuCollection.find({}).sort({ createdAt: -1 }).toArray();
        res.status(200).json({ success: true, data: items });
      } catch (error) {
        console.error("Error fetching menu items:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // POST: Add new menu item
    app.post("/api/menu-items", async (req, res) => {
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
    app.put("/api/menu-items/:id", async (req, res) => {
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
    app.delete("/api/menu-items/:id", async (req, res) => {
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

    // ==========================================
    // 2. CUSTOMER ORDERS & LIFECYCLE ROUTES
    // ==========================================

    // POST: Customer confirm selection -> save to 'confirmed-item'
    app.post("/api/confirmed-items", async (req, res) => {
      try {
        const orderData = req.body;

        if (!orderData.guestId) {
          return res.status(400).json({
            success: false,
            message: "Guest ID is required!",
          });
        }

        const unitPrice = parseFloat(orderData.price) || 0;
        const qty = parseInt(orderData.quantity) || 1;
        const totalAmount = parseFloat((unitPrice * qty).toFixed(2));
        const tableNo = (orderData.tableNo || "01").toString().padStart(2, "0");
        const sessionId = orderData.sessionId || `SES-T${tableNo}-${orderData.guestId}`;
        const orderNumber = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

        const confirmedOrder = {
          orderNumber,
          guestId: orderData.guestId,
          tableNo,
          sessionId,
          itemId: orderData.itemId || "",
          name: orderData.name || "Item",
          price: unitPrice,
          quantity: qty,
          totalAmount,
          imageUrl: orderData.imageUrl || "",
          specialInstructions: orderData.specialInstructions || "",
          status: "Pending", // Pending -> Confirmed -> Preparing -> Ready -> Served -> Completed | Rejected
          paymentStatus: "Unpaid", // Unpaid | Paid
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await confirmedCollection.insertOne(confirmedOrder);

        // Update table to Occupied
        await tablesCollection.updateOne(
          { tableNo },
          {
            $set: {
              status: "Occupied",
              currentSessionId: sessionId,
              currentGuestId: orderData.guestId,
              lastUpdated: new Date(),
            },
          },
          { upsert: true }
        );

        res.status(201).json({
          success: true,
          message: "Order successfully confirmed and saved!",
          orderId: result.insertedId,
          orderNumber,
          guestId: orderData.guestId,
          tableNo,
          sessionId,
        });
      } catch (error) {
        console.error("Error saving confirmed item:", error);
        res.status(500).json({
          success: false,
          message: "Internal server error",
        });
      }
    });

    // GET: Fetch confirmed orders for customer (by guestId or sessionId)
    app.get("/api/confirmed-items", async (req, res) => {
      try {
        const guestId = req.query.guestId as string;
        const sessionId = req.query.sessionId as string;

        if (!guestId && !sessionId) {
          return res.status(400).json({
            success: false,
            message: "Guest ID or Session ID is required!",
          });
        }

        const filter: any = {};
        if (sessionId) {
          filter.sessionId = sessionId;
        } else if (guestId) {
          filter.guestId = guestId;
        }

        const orders = await confirmedCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .toArray();

        return res.status(200).json({
          success: true,
          data: orders,
        });
      } catch (error) {
        console.error("Error fetching confirmed items:", error);
        return res.status(500).json({
          success: false,
          message: "Internal server error",
        });
      }
    });

    // GET: Manager live orders (active orders)
    app.get("/api/manager/confirmed-items", async (req, res) => {
      try {
        const includeAll = req.query.all === "true";
        const filter = includeAll ? {} : { status: { $ne: "Completed" } };

        const orders = await confirmedCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .toArray();

        return res.status(200).json({
          success: true,
          data: orders,
        });
      } catch (error) {
        console.error("Error fetching manager orders:", error);
        return res.status(500).json({
          success: false,
          message: "Internal server error",
        });
      }
    });

    // PATCH: Manager updates order status
    // Allowed transitions: Pending -> Confirmed -> Preparing -> Ready -> Served -> Completed | Rejected
    app.patch("/api/confirmed-items/:id/status", async (req, res) => {
      try {
        const id = req.params.id;
        const { status, rejectionReason } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ success: false, message: "Invalid order ID" });
        }

        const validStatuses = [
          "Pending",
          "Confirmed",
          "Preparing",
          "Cooking", // backwards-compatible alias for Preparing
          "Ready",
          "Served",
          "Completed",
          "Rejected",
        ];

        // Standardize alias
        const targetStatus = status === "Cooking" ? "Preparing" : status;

        if (!validStatuses.includes(status)) {
          return res.status(400).json({
            success: false,
            message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
          });
        }

        const updateDoc: any = {
          status: targetStatus,
          updatedAt: new Date(),
        };

        if (targetStatus === "Rejected" && rejectionReason) {
          updateDoc.rejectionReason = rejectionReason;
        }

        const result = await confirmedCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updateDoc },
          { returnDocument: "after" }
        );

        if (!result) {
          return res.status(404).json({ success: false, message: "Order not found" });
        }

        // Check if table status needs update based on order state
        const tableNo = result.tableNo;
        if (tableNo) {
          if (targetStatus === "Preparing") {
            await tablesCollection.updateOne({ tableNo }, { $set: { status: "Cooking" } });
          }
        }

        res.status(200).json({
          success: true,
          message: `Order status updated to ${targetStatus}!`,
          order: result,
        });
      } catch (error) {
        console.error("Error updating order status:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // DELETE: Customer removes unconfirmed item (only allowed if still Pending)
    app.delete("/api/confirmed-items/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const guestId = req.query.guestId as string;

        if (!guestId || guestId.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: "Guest ID is required!",
          });
        }

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            success: false,
            message: "Invalid order ID.",
          });
        }

        const order = await confirmedCollection.findOne({
          _id: new ObjectId(id),
          guestId,
        });

        if (!order) {
          return res.status(404).json({ success: false, message: "Order item not found" });
        }

        // Protection: Customer can only cancel Pending orders
        if (order.status !== "Pending") {
          return res.status(400).json({
            success: false,
            message: `Cannot cancel this order because it is already ${order.status.toLowerCase()}. Please speak to a waiter.`,
          });
        }

        await confirmedCollection.deleteOne({ _id: new ObjectId(id) });

        res.status(200).json({ success: true, message: "Item removed from orders!" });
      } catch (error) {
        console.error("Error deleting confirmed item:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // ==========================================
    // 3. KITCHEN ORDER PROCESSING (KDS)
    // ==========================================

    // GET: Active orders for kitchen display (Confirmed, Preparing, Ready)
    app.get("/api/kitchen/orders", async (req, res) => {
      try {
        const kitchenOrders = await confirmedCollection
          .find({
            status: { $in: ["Confirmed", "Preparing", "Cooking", "Ready"] },
          })
          .sort({ createdAt: 1 }) // oldest first for priority
          .toArray();

        // Standardize any legacy Cooking status
        const standardized = kitchenOrders.map((o) => ({
          ...o,
          status: o.status === "Cooking" ? "Preparing" : o.status,
        }));

        res.status(200).json({ success: true, data: standardized });
      } catch (error) {
        console.error("Error fetching kitchen orders:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // ==========================================
    // 4. BILL REQUEST WORKFLOW
    // ==========================================

    // POST: Customer submits bill request
    app.post("/api/bill-requests", async (req, res) => {
      try {
        const { guestId, tableNo, sessionId } = req.body;

        if (!guestId) {
          return res.status(400).json({ success: false, message: "Guest ID is required!" });
        }

        const table = (tableNo || "01").toString().padStart(2, "0");
        const session = sessionId || `SES-T${table}-${guestId}`;

        // Check for existing active bill request for this session
        const existingRequest = await billRequestsCollection.findOne({
          sessionId: session,
          status: { $in: ["Requested", "Reviewing", "Bill Generated"] },
        });

        if (existingRequest) {
          return res.status(200).json({
            success: true,
            message: "Bill request already submitted and is in progress.",
            data: existingRequest,
            isDuplicate: true,
          });
        }

        // Fetch customer's orders to compute current total
        const sessionOrders = await confirmedCollection
          .find({
            sessionId: session,
            status: { $ne: "Rejected" },
          })
          .toArray();

        const subtotal = sessionOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const taxAmount = parseFloat((subtotal * 0.05).toFixed(2));
        const grandTotal = parseFloat((subtotal + taxAmount).toFixed(2));

        const newBillRequest = {
          guestId,
          tableNo: table,
          sessionId: session,
          itemCount: sessionOrders.length,
          subtotal,
          taxAmount,
          grandTotal,
          status: "Requested", // Requested -> Reviewing -> Bill Generated -> Paid -> Completed
          requestedAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await billRequestsCollection.insertOne(newBillRequest);

        // Update table status to Bill Requested
        await tablesCollection.updateOne(
          { tableNo: table },
          { $set: { status: "Bill Requested", lastUpdated: new Date() } }
        );

        res.status(201).json({
          success: true,
          message: "Bill request successfully submitted to the manager!",
          data: { ...newBillRequest, _id: result.insertedId },
        });
      } catch (error) {
        console.error("Error creating bill request:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // GET: Fetch active bill request for customer
    app.get("/api/bill-requests/active", async (req, res) => {
      try {
        const guestId = req.query.guestId as string;
        const sessionId = req.query.sessionId as string;

        if (!guestId && !sessionId) {
          return res.status(400).json({ success: false, message: "Guest ID or Session ID required." });
        }

        const filter: any = {};
        if (sessionId) filter.sessionId = sessionId;
        else filter.guestId = guestId;

        const latestRequest = await billRequestsCollection
          .find(filter)
          .sort({ requestedAt: -1 })
          .limit(1)
          .toArray();

        res.status(200).json({
          success: true,
          data: latestRequest.length > 0 ? latestRequest[0] : null,
        });
      } catch (error) {
        console.error("Error fetching active bill request:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // GET: Manager lists all bill requests
    app.get("/api/bill-requests", async (req, res) => {
      try {
        const status = req.query.status as string;
        const filter = status ? { status } : {};

        const requests = await billRequestsCollection
          .find(filter)
          .sort({ requestedAt: -1 })
          .toArray();

        res.status(200).json({ success: true, data: requests });
      } catch (error) {
        console.error("Error fetching bill requests:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // PATCH: Manager updates bill request status
    app.patch("/api/bill-requests/:id/status", async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ success: false, message: "Invalid bill request ID." });
        }

        const validStatuses = ["Requested", "Reviewing", "Bill Generated", "Paid", "Completed"];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ success: false, message: "Invalid bill request status." });
        }

        const result = await billRequestsCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { status, updatedAt: new Date() } },
          { returnDocument: "after" }
        );

        if (!result) {
          return res.status(404).json({ success: false, message: "Bill request not found." });
        }

        res.status(200).json({ success: true, message: "Bill request updated.", data: result });
      } catch (error) {
        console.error("Error updating bill request status:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // ==========================================
    // 5. INVOICE GENERATION & PRINT
    // ==========================================

    // POST: Generate Invoice from verified backend orders
    app.post("/api/invoices/generate", async (req, res) => {
      try {
        const { sessionId, guestId, tableNo } = req.body;

        if (!sessionId && !guestId) {
          return res.status(400).json({ success: false, message: "Session ID or Guest ID required." });
        }

        const session = sessionId || `SES-T${tableNo || "01"}-${guestId}`;

        // Check if invoice already generated for this session
        const existingInvoice = await invoicesCollection.findOne({ sessionId: session });
        if (existingInvoice) {
          return res.status(200).json({
            success: true,
            message: "Invoice already generated for this session.",
            data: existingInvoice,
            isExisting: true,
          });
        }

        // Fetch verified orders from database for this session
        const sessionOrders = await confirmedCollection
          .find({
            sessionId: session,
            status: { $ne: "Rejected" },
          })
          .toArray();

        if (sessionOrders.length === 0) {
          return res.status(400).json({
            success: false,
            message: "No active orders found for this dining session.",
          });
        }

        // Calculate backend verified totals
        const items = sessionOrders.map((o) => ({
          orderId: o._id,
          orderNumber: o.orderNumber || "ORD",
          name: o.name,
          quantity: o.quantity,
          unitPrice: o.price,
          totalAmount: o.totalAmount,
        }));

        const subtotal = parseFloat(items.reduce((sum, item) => sum + item.totalAmount, 0).toFixed(2));
        const taxRate = 0.05; // 5% VAT
        const taxAmount = parseFloat((subtotal * taxRate).toFixed(2));
        const grandTotal = parseFloat((subtotal + taxAmount).toFixed(2));

        const invoiceNo = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const table = (tableNo || sessionOrders[0].tableNo || "01").toString().padStart(2, "0");

        const newInvoice = {
          invoiceNo,
          restaurantName: "SAVOR Restaurant & Cafe",
          restaurantAddress: "House 14, Road 7, Banani, Dhaka, Bangladesh",
          restaurantPhone: "+880 1700-000000",
          tableNo: table,
          guestId: guestId || sessionOrders[0].guestId,
          sessionId: session,
          items,
          subtotal,
          taxRate: 5,
          taxAmount,
          grandTotal,
          paymentStatus: "Unpaid", // Unpaid | Paid
          paymentMethod: null, // Cash | Card | Mobile Pay / POS
          createdAt: new Date(),
          paidAt: null,
        };

        const result = await invoicesCollection.insertOne(newInvoice);

        // Update bill request to Bill Generated
        await billRequestsCollection.updateMany(
          { sessionId: session },
          { $set: { status: "Bill Generated", updatedAt: new Date() } }
        );

        // Update table to Payment Pending
        await tablesCollection.updateOne(
          { tableNo: table },
          { $set: { status: "Payment Pending", lastUpdated: new Date() } }
        );

        res.status(201).json({
          success: true,
          message: "Invoice generated successfully!",
          data: { ...newInvoice, _id: result.insertedId },
        });
      } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // GET: Invoice by session ID
    app.get("/api/invoices/session/:sessionId", async (req, res) => {
      try {
        const sessionId = req.params.sessionId;
        const invoice = await invoicesCollection.findOne({ sessionId });

        if (!invoice) {
          return res.status(404).json({ success: false, message: "Invoice not found for this session." });
        }

        res.status(200).json({ success: true, data: invoice });
      } catch (error) {
        console.error("Error fetching invoice:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // GET: All invoices (Manager)
    app.get("/api/invoices", async (req, res) => {
      try {
        const invoices = await invoicesCollection.find({}).sort({ createdAt: -1 }).toArray();
        res.status(200).json({ success: true, data: invoices });
      } catch (error) {
        console.error("Error fetching invoices:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // ==========================================
    // 6. PAYMENT CONFIRMATION & SESSION CLOSURE
    // ==========================================

    // POST: Manager confirms payment (Cash, Card, Mobile Pay / POS)
    app.post("/api/invoices/:id/confirm-payment", async (req, res) => {
      try {
        const id = req.params.id;
        const { paymentMethod = "Cash" } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ success: false, message: "Invalid invoice ID." });
        }

        const invoice = await invoicesCollection.findOne({ _id: new ObjectId(id) });
        if (!invoice) {
          return res.status(404).json({ success: false, message: "Invoice not found." });
        }

        const paidAt = new Date();

        // 1. Update invoice
        await invoicesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              paymentStatus: "Paid",
              paymentMethod,
              paidAt,
            },
          }
        );

        // 2. Update all orders in this session: Order Status: Completed, Payment Status: Paid
        await confirmedCollection.updateMany(
          { sessionId: invoice.sessionId, status: { $ne: "Rejected" } },
          {
            $set: {
              status: "Completed",
              paymentStatus: "Paid",
              updatedAt: paidAt,
            },
          }
        );

        // 3. Update bill request
        await billRequestsCollection.updateMany(
          { sessionId: invoice.sessionId },
          {
            $set: {
              status: "Paid",
              updatedAt: paidAt,
            },
          }
        );

        // 4. Record closed session
        await sessionsCollection.insertOne({
          sessionId: invoice.sessionId,
          tableNo: invoice.tableNo,
          guestId: invoice.guestId,
          invoiceNo: invoice.invoiceNo,
          grandTotal: invoice.grandTotal,
          paymentMethod,
          closedAt: paidAt,
        });

        // 5. Complete session: Table becomes Available again!
        await tablesCollection.updateOne(
          { tableNo: invoice.tableNo },
          {
            $set: {
              status: "Available",
              currentSessionId: null,
              currentGuestId: null,
              lastUpdated: paidAt,
            },
          }
        );

        res.status(200).json({
          success: true,
          message: `Payment of ৳${invoice.grandTotal} confirmed via ${paymentMethod}! Session completed and Table ${invoice.tableNo} is now Available.`,
        });
      } catch (error) {
        console.error("Error confirming payment:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // ==========================================
    // 7. COMPLETED ORDERS & HISTORY
    // ==========================================

    // GET: Historical completed orders with filtering
    app.get("/api/manager/completed-orders", async (req, res) => {
      try {
        const { dateFilter = "all", tableNo, search } = req.query;

        const filter: any = {
          status: "Completed",
        };

        if (tableNo) {
          filter.tableNo = (tableNo as string).padStart(2, "0");
        }

        if (search) {
          filter.$or = [
            { orderNumber: { $regex: search as string, $options: "i" } },
            { name: { $regex: search as string, $options: "i" } },
            { guestId: { $regex: search as string, $options: "i" } },
          ];
        }

        if (dateFilter === "today") {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          filter.createdAt = { $gte: startOfToday };
        } else if (dateFilter === "previous") {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          filter.createdAt = { $lt: startOfToday };
        }

        const completedOrders = await confirmedCollection
          .find(filter)
          .sort({ updatedAt: -1, createdAt: -1 })
          .toArray();

        res.status(200).json({
          success: true,
          data: completedOrders,
          count: completedOrders.length,
        });
      } catch (error) {
        console.error("Error fetching completed orders:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // ==========================================
    // 8. TABLE MANAGEMENT & OVERVIEW STATS
    // ==========================================

    // GET: All restaurant tables with live session summaries
    app.get("/api/tables", async (req, res) => {
      try {
        const tables = await tablesCollection.find({}).sort({ tableNo: 1 }).toArray();

        // Attach live order count for each occupied table
        const enrichedTables = await Promise.all(
          tables.map(async (table) => {
            if (table.currentSessionId) {
              const activeOrders = await confirmedCollection
                .find({
                  sessionId: table.currentSessionId,
                  status: { $nin: ["Completed", "Rejected"] },
                })
                .toArray();

              const totalActiveAmount = activeOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

              return {
                ...table,
                activeOrderCount: activeOrders.length,
                totalActiveAmount,
              };
            }
            return {
              ...table,
              activeOrderCount: 0,
              totalActiveAmount: 0,
            };
          })
        );

        res.status(200).json({ success: true, data: enrichedTables });
      } catch (error) {
        console.error("Error fetching tables:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // POST: Add a new dining table
    app.post("/api/tables", async (req, res) => {
      try {
        const { tableNo, capacity = 4 } = req.body;
        if (!tableNo) {
          return res.status(400).json({ success: false, message: "Table number is required." });
        }

        const formatted = tableNo.toString().padStart(2, "0");
        const existing = await tablesCollection.findOne({ tableNo: formatted });

        if (existing) {
          return res.status(400).json({ success: false, message: `Table ${formatted} already exists.` });
        }

        const newTable = {
          tableNo: formatted,
          capacity: parseInt(capacity) || 4,
          status: "Available",
          currentSessionId: null,
          currentGuestId: null,
          lastUpdated: new Date(),
        };

        const result = await tablesCollection.insertOne(newTable);
        res.status(201).json({
          success: true,
          message: `Table ${formatted} successfully added!`,
          data: { ...newTable, _id: result.insertedId },
        });
      } catch (error) {
        console.error("Error adding table:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // POST: Quick Bulk Add tables (e.g. Add 5 more tables)
    app.post("/api/tables/bulk-add", async (req, res) => {
      try {
        const count = parseInt(req.body.count) || 5;
        const allTables = await tablesCollection.find({}).toArray();

        // Find max table number
        let maxNo = 0;
        allTables.forEach((t: any) => {
          const parsed = parseInt(t.tableNo, 10);
          if (!isNaN(parsed) && parsed > maxNo) maxNo = parsed;
        });

        const newTables = Array.from({ length: count }, (_, i) => {
          const num = maxNo + i + 1;
          const tableNo = num.toString().padStart(2, "0");
          return {
            tableNo,
            capacity: num % 2 === 0 ? 4 : 2,
            status: "Available",
            currentSessionId: null,
            currentGuestId: null,
            lastUpdated: new Date(),
          };
        });

        await tablesCollection.insertMany(newTables);
        res.status(201).json({
          success: true,
          message: `Successfully created ${count} new tables! (Tables ${newTables[0].tableNo} to ${newTables[newTables.length - 1].tableNo})`,
          data: newTables,
        });
      } catch (error) {
        console.error("Error bulk adding tables:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // PATCH: Manager manual table status update / reset
    app.patch("/api/tables/:tableNo/status", async (req, res) => {
      try {
        const tableNo = req.params.tableNo.padStart(2, "0");
        const { status } = req.body;

        const updateData: any = {
          status,
          lastUpdated: new Date(),
        };

        if (status === "Available") {
          updateData.currentSessionId = null;
          updateData.currentGuestId = null;
        }

        const result = await tablesCollection.updateOne({ tableNo }, { $set: updateData });

        if (result.matchedCount === 0) {
          return res.status(404).json({ success: false, message: "Table not found." });
        }

        res.status(200).json({ success: true, message: `Table ${tableNo} status set to ${status}.` });
      } catch (error) {
        console.error("Error updating table status:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    // GET: Manager overview statistics
    app.get("/api/manager/stats", async (req, res) => {
      try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        // 1. Total revenue today from paid invoices
        const todayPaidInvoices = await invoicesCollection
          .find({
            paymentStatus: "Paid",
            paidAt: { $gte: startOfToday },
          })
          .toArray();

        const todayRevenue = todayPaidInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);

        // 2. Active orders count
        const activeOrdersCount = await confirmedCollection.countDocuments({
          status: { $in: ["Pending", "Confirmed", "Preparing", "Cooking", "Ready", "Served"] },
        });

        // 3. Occupied tables count
        const occupiedTablesCount = await tablesCollection.countDocuments({
          status: { $ne: "Available" },
        });

        // 4. Pending bill requests count
        const pendingBillsCount = await billRequestsCollection.countDocuments({
          status: { $in: ["Requested", "Reviewing", "Bill Generated"] },
        });

        // 5. Recent 5 orders
        const recentOrders = await confirmedCollection
          .find({})
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();

        res.status(200).json({
          success: true,
          data: {
            todayRevenue,
            activeOrdersCount,
            occupiedTablesCount,
            pendingBillsCount,
            recentOrders,
          },
        });
      } catch (error) {
        console.error("Error fetching manager stats:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
      }
    });

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
  }
}

startServer();

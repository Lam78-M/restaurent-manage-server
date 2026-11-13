import { Router } from "express";
import { ObjectId } from "mongodb";
import type { Collections } from "../models/collections";

export function createInvoiceRoutes(collections: Collections) {
  const { invoicesCollection, confirmedCollection, billRequestsCollection, tablesCollection, sessionsCollection } = collections;
  const router = Router();

  // ==========================================
  // 5. INVOICE GENERATION & PRINT
  // ==========================================

  // POST: Generate Invoice from verified backend orders
  router.post("/api/invoices/generate", async (req, res) => {
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
  router.get("/api/invoices/session/:sessionId", async (req, res) => {
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
  router.get("/api/invoices", async (req, res) => {
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
  router.post("/api/invoices/:id/confirm-payment", async (req, res) => {
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


  return router;
}

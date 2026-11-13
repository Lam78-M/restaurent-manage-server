import cors from "cors";
import express, { type Express } from "express";

export function configureMiddleware(app: Express) {
  app.use(cors());
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));
}

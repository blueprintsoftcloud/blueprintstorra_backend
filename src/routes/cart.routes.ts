import { Router } from "express";
import {
  cartAdd,
  cartList,
  cartRemove,
  updateProductQuantity,
} from "../controllers/cart.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.post("/add", authMiddleware, cartAdd);
router.get("/list", authMiddleware, cartList);
router.delete("/remove/:productId", authMiddleware, cartRemove);
router.put("/updateQuantity/:productId", authMiddleware, updateProductQuantity);

export default router;

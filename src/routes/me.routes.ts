import { Router } from "express";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Who am I? Useful for the frontend to confirm the token works end-to-end.
router.get("/", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;

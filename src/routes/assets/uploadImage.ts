import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

const router = express.Router();

// 临时上传目录
const UPLOAD_DIR = path.join(process.cwd(), ".tmp", "uploads");

// multer 配置
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`不支持的图片格式: ${ext}`));
  },
});

/**
 * POST /api/assets/uploadImage
 * 上传图片 + 创建资产（一步到位）
 * 
 * multipart/form-data:
 *   file: 图片文件
 *   name: 资产名称
 *   describe: 资产描述
 *   type: role | scene | tool | clip
 *   projectId: 项目ID
 *   prompt: 提示词（可选）
 *   remark: 备注（可选）
 *   ossDir: OSS存储子目录（默认: assets/{projectId}/{name}）
 */
export default router.post(
  "/",
  upload.single("file"),
  async (req, res) => {
    try {
      const { name, describe, type, projectId, prompt, remark, ossDir } = req.body;
      const file = req.file;
      if (!file) return res.status(400).send(error("未上传文件"));
      if (!name || !type || !projectId) {
        return res.status(400).send(error("缺少必填字段: name, type, projectId"));
      }

      const pid = Number(projectId);

      // 1. 确定 OSS 存储路径
      const relDir = ossDir || `assets/${pid}/${name}`;
      const relPath = `${relDir}/image${path.extname(file.path) || ".png"}`;

      // 2. 复制文件到 OSS 目录
      const destPath = path.join(u.getPath("oss"), relPath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(file.path, destPath);

      // 3. 生成缩略图
      try {
        const smallDir = path.join(u.getPath("oss"), "smallImage", relDir);
        await fs.mkdir(smallDir, { recursive: true });
        await sharp(destPath)
          .resize(512, 512, { fit: "inside", withoutEnlargement: true })
          .toFile(path.join(smallDir, `image${path.extname(destPath)}`));
      } catch (e) {
        console.warn("[uploadImage] 缩略图生成失败:", e);
      }

      // 4. 清理临时文件
      await fs.unlink(file.path).catch(() => {});

      // 5. 创建 o_image 记录
      const [imageId] = await u.db("o_image").insert({
        filePath: relPath,
        type,
        state: "已完成",
      });

      // 6. 创建 o_asset 记录并关联 imageId
      const [assetId] = await u.db("o_assets").insert({
        name,
        describe: describe || "",
        type,
        projectId: pid,
        imageId,
        prompt: prompt || null,
        remark: remark || null,
        startTime: Date.now(),
      });

      // 7. 获取图片 URL
      const imageUrl = await u.oss.getFileUrl(relPath);
      const thumbnailUrl = await u.oss.getSmallImageUrl(relPath);

      res.status(200).send(
        success({
          assetId,
          imageId,
          filePath: relPath,
          imageUrl,
          thumbnailUrl,
        }),
      );
    } catch (err: any) {
      console.error("[uploadImage] 上传失败:", err);
      res.status(500).send(error(err?.message || "上传失败"));
    }
  },
);

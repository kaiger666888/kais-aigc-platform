import express from "express";
import u from "@/utils";
const router = express.Router();
import { z } from "zod";
import { error } from "@/lib/responseFormat";

export default router.get("/", async (req, res, next) => {
  const id = 14;
  const targetOutlineData = await u.db("t_outline").where("id", id).select("data").first();
  if (!targetOutlineData) return res.status(400).send(error("大纲不存在"));
  //筛选出改大纲特有的资产
  const allOutlineDataList = await u.db("t_outline").where("projectId", 8).andWhere("id", "!=", id).select("data");
  //找出目标ID大纲特有的资产名称
  const allOutlineData = allOutlineDataList
    .map((item) => {
      const data = JSON.parse(item?.data || "[]");
      return [...data.characters, ...data.props, ...data.scenes].map((item: any) => item.name);
    })
    .flat();

  const targetOutLineNames = JSON.parse(targetOutlineData?.data || "[]");
  const targetNames = [...targetOutLineNames.characters, ...targetOutLineNames.props, ...targetOutLineNames.scenes].map((item: any) => item.name);

  const diffAssetsNames = targetNames.filter((item) => !allOutlineData.includes(item));

  res.status(200).send(123);
});

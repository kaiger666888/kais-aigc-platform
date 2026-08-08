#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 Notion 金标准创作文档（《她从深渊归来》）转化为 KMC 管线文字资产，
写入 KAP 数据库 o_assets 表，并同步 canvas_nodes。

数据源（已提取到本地）：
  /tmp/notion_full_content.txt            — 20集剧本 + 分镜脚本 + BGM总谱 + 各设定表
  /tmp/notion_table_角色视觉设定表_0.json   — 8角色视觉锚点前缀
  /tmp/notion_table_角色音色设定表_0.json   — 8角色+旁白 TTS音色设定
  /tmp/notion_table_场景美术设定表_0.json   — 22场景美术设定
  /tmp/notion_table_分场服化道表_0.json     — 78行分场服化道

硬性原则：
  1. 创作文档是金标准 —— 原文 verbatim 提取，不允许 AI 改写/篡改。
  2. 角色名以 Notion 为准（陆衍舟 / 沈知意 / 沈知瑶 / 程屿 / 沈正邦 / 顾鸿远 / 周琳 / 王建民）。
  3. 所有资产必须携带 prompt（非 NULL）。

只新增、不修改/删除现有 617 个视觉/声音资产。本脚本仅清理自身 createdBy='notion-import'
的历史导入行，保证可重入。
"""
import json
import os
import re
import sqlite3
import sys

DB = "/data/workspace/kais-aigc-platform/data/db2.sqlite"
PROJECT = 1785508691757
EP = 1
CREATED_BY = "notion-import"

# 用固定时间戳（脚本运行时刻），保证整批一致；进程内不再变。
import time
NOW = int(time.time() * 1000)

# ────────────────────────────────────────────────────────────────────
# 工具
# ────────────────────────────────────────────────────────────────────

CN_DIGITS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
             "六": 6, "七": 7, "八": 8, "九": 9}


def cn2int(s: str) -> int:
    """中文数字（1..99）→ int。覆盖 一..二十。"""
    if s == "十":
        return 10
    if s.startswith("十"):
        return 10 + CN_DIGITS[s[1]]
    if s.endswith("十"):
        return CN_DIGITS[s[0]] * 10
    if "十" in s:
        a, _, b = s.partition("十")
        return CN_DIGITS[a] * 10 + (CN_DIGITS[b] if b else 0)
    return CN_DIGITS[s]


def clean_cell(s: str) -> str:
    """去掉 Notion 导出的 HTML 残片（<p"> </p> 等）与首尾空白。"""
    if s is None:
        return ""
    s = re.sub(r"<[^>]+>", "", s)
    return s.strip()


def split_sections(text: str) -> dict:
    """
    全文按 `====`(40+ 等号) 分隔块切分。
    结构：==== / ## 标题 / ==== / 内容 / ==== / ## 标题2 / ==== / 内容2 ...
    → {标题: 内容}
    """
    parts = re.split(r"^={40,}\s*$", text, flags=re.MULTILINE)
    sections = {}
    for i in range(1, len(parts) - 1, 2):
        title = parts[i].strip().lstrip("#").strip()
        content = parts[i + 1]
        sections[title] = content
    return sections


EP_HEADER_RE = re.compile(
    r"^##\s*第([零一二三四五六七八九十]+)集[「『]([^」』]+)[」』]\s*$",
    re.MULTILINE,
)
SB_TITLE_RE = re.compile(
    r"^#\s*第([零一二三四五六七八九十]+)集[「『]([^」』]+)[」』]\s*$",
    re.MULTILINE,
)
# 分镜详表正文头：block2 中每集分镜的真正起点（Ep1-3 的 h1 标题在顶部连排，
# 不能用 h1 切分，否则只会切到标题串；以 `## 第N集分镜详表` 为准）。
SB_DETAIL_RE = re.compile(
    r"^##\s*第([零一二三四五六七八九十]+)集分镜详表\s*$",
    re.MULTILINE,
)


def split_episodes(block: str, header_re) -> dict:
    """
    按集标题切分。返回 {ep_int: {"title": str, "body": str}}。
    body 为该集标题行之后到下一集标题之前的全部原文。
    """
    matches = list(header_re.finditer(block))
    eps = {}
    for idx, m in enumerate(matches):
        ep = cn2int(m.group(1))
        title = m.group(2).strip()
        start = m.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(block)
        body = block[start:end].strip()
        eps[ep] = {"title": title, "body": body}
    return eps


def split_storyboards(block: str):
    """
    block2 分镜脚本按集切分，以 `## 第N集分镜详表` 为每集起点，
    到下一个 h1 头（集标题 `# 第M集「」` 或 `# 附录…`）或下一处分镜详表头为止。
    返回 (episodes_dict, appendix_text)：
      episodes_dict = {ep_int: body_str}（verbatim 分镜详表正文，不含附录）
      appendix_text = 所有 `# 附录…` 块 + 文档头说明（verbatim，避免金标准内容丢失）
    """
    details = list(SB_DETAIL_RE.finditer(block))
    # 所有 h1 行（集标题 / 附录 / 幕标题）+ 所有分镜详表 h2 头 = 边界
    h1_starts = [mt.start() for mt in re.finditer(r"^#\s+\S", block, re.MULTILINE)]
    detail_starts = [md.start() for md in details]
    boundaries = sorted(set(h1_starts + detail_starts))

    out = {}
    for md in details:
        ep = cn2int(md.group(1))
        start = md.end()
        later = [b for b in boundaries if b > md.start()]
        end = min(later) if later else len(block)
        out[ep] = block[start:end].strip()

    # 附录块（# 附录…）verbatim 单独保留
    appx = []
    for mt in re.finditer(r"^#\s*附录", block, re.MULTILINE):
        start = mt.start()
        later = [b for b in (h1_starts + detail_starts) if b > start]
        end = min(later) if later else len(block)
        appx.append(block[start:end].strip())
    # block2 文档头说明（第一处分镜详表头之前的导言）也保留
    first_detail = min(detail_starts) if detail_starts else len(block)
    intro = block[:first_detail].strip()
    appendix_text = ("\n\n---\n\n".join(appx))
    if intro:
        appendix_text = intro + ("\n\n---\n\n" + appendix_text if appendix_text else "")
    return out, appendix_text


def extract_field(body: str, field: str) -> str:
    """从剧本 body 提取 `• 字段：值` 形式的字段（verbatim）。"""
    pat = re.compile(r"^[•\-\*]\s*" + re.escape(field) + r"\s*[：:]\s*(.+)$",
                     re.MULTILINE)
    m = pat.search(body)
    return m.group(1).strip() if m else ""


def extract_hook_lines(body: str) -> list:
    """提取钩子检查表的 ✅ 行（verbatim）。"""
    block = re.search(r"【钩子检查表[^】]*】(.*?)(?=^###\s|\Z)", body,
                      re.MULTILINE | re.DOTALL)
    src = block.group(1) if block else body
    return [ln.strip().lstrip("•").strip()
            for ln in src.splitlines()
            if "✅" in ln or re.match(r"^[•\-\*]\s*", ln) and ln.strip()]


# ────────────────────────────────────────────────────────────────────
# 角色映射（DB 既有拼音 characterId 为准）
# ────────────────────────────────────────────────────────────────────

CHAR_CANON = {
    "沈知意": ("shenzhiyi", "女主", 22),
    "陆衍舟": ("luyanzhou", "男主/反派", 26),
    "沈知瑶": ("shenzhiyao", "女配", 21),
    "程屿": ("chengyu", "男配", 25),
    "沈正邦": ("shenzhengbang", "男配", 58),
    "顾鸿远": ("guhongyuan", "男配", 62),
    "周琳": ("zhoulin", "女配", 40),
    "王建民": ("wangjianmin", "男配", 50),
}


def char_key(name_cell: str) -> str:
    """从 '沈知意（女主·22岁）' 取角色名（首个全角/半角括号前）。"""
    return re.split(r"[（(]", name_cell, 1)[0].strip()


# ────────────────────────────────────────────────────────────────────
# 资产行构造
# ────────────────────────────────────────────────────────────────────

def asset_row(*, name, type_, subtype, prompt, meta, character_id=None,
              is_primary=1, view_angle=None):
    """构造一条 o_assets 字典。meta 为 dict，会 JSON 序列化。"""
    assert prompt, f"prompt 为空: {name}"
    meta = dict(meta)
    meta["subtype"] = subtype
    meta["source"] = "notion"
    return {
        "name": name,
        "prompt": prompt,
        "type": type_,
        "projectId": PROJECT,
        "episodesId": EP,
        "characterId": character_id,
        "viewAngle": view_angle,
        "isPrimaryView": 1 if is_primary else 0,
        "state": "active",
        "tags": "notion-import",
        "meta": json.dumps(meta, ensure_ascii=False),
        "createdAt": NOW,
        "createdBy": CREATED_BY,
    }


def main():
    if not os.path.exists(DB):
        sys.exit(f"DB 不存在: {DB}")

    full = open("/tmp/notion_full_content.txt", encoding="utf-8").read()
    vis = json.load(open("/tmp/notion_table_角色视觉设定表_0.json"))
    voc = json.load(open("/tmp/notion_table_角色音色设定表_0.json"))
    sce = json.load(open("/tmp/notion_table_场景美术设定表_0.json"))
    cos = json.load(open("/tmp/notion_table_分场服化道表_0.json"))

    sections = split_sections(full)
    block1 = sections.get("剧情", "")
    block2 = sections.get("分镜脚本", "")
    bgm_text = sections.get("全剧BGM与混音", "")
    assert block1, "未找到「剧情」section"
    assert bgm_text, "未找到「全剧BGM与混音」section"

    eps_script = split_episodes(block1, EP_HEADER_RE)
    eps_sb, sb_appendix = split_storyboards(block2)
    assert len(eps_script) == 20, f"剧本集数={len(eps_script)} != 20"
    print(f"[parse] 剧本 {len(eps_script)} 集 | 分镜详表 {len(eps_sb)} 集 | "
          f"附录 {len(sb_appendix)} 字符")

    # 视觉/音色表 → 按 char_key 索引
    vis_map = {char_key(r[0]): r[1] for r in vis[1:]}
    voc_map = {char_key(r[0]): r[1] for r in voc[1:]}

    assets = []  # list[dict]

    # ── 1. requirement（管线种子）─────────────────────────────────
    assets.append(asset_row(
        name="她从深渊归来 - requirement",
        type_="requirement", subtype="requirement",
        prompt=("重生复仇短剧《她从深渊归来》，20集竖屏短剧。女主沈知意重生回到签婚前协议的那一刻，"
                "用前世记忆的信息差优势逐步复仇。主题：女性觉醒、家族阴谋、信息差博弈。"
                "基调：暗黑复仇+悬疑+商战。目标受众：18-35岁女性。"),
        meta={
            "genre": "重生复仇/商战悬疑",
            "tone": "暗黑/悬疑/爽文",
            "language": "zh",
            "total_episodes": 20,
            "form_factor": "portrait",
            "visual_style": "电影级竖屏画质",
            "creative_brief": ("20集竖屏短剧，每集约80-90秒。重生复仇题材，信息差博弈驱动剧情。"
                               "分为4个层级(L1-L4)：L1用前世记忆直接反击(Ep1-5)、L2建立反击联盟(Ep6-10)、"
                               "L3发现真凶(Ep11-16)、L4放弃前世记忆依赖用现时能力赢(Ep17-20)。"),
        },
    ))

    # ── 2. story-framework（20集故事框架）────────────────────────
    outline = []
    for ep in sorted(eps_script):
        info = eps_script[ep]
        body = info["body"]
        scene = extract_field(body, "场景")
        prop = extract_field(body, "关键道具")
        expose = extract_field(body, "暴露状态")
        t0 = extract_field(body, "T0主角已知")
        hooks = extract_hook_lines(body)
        emo_chain = next((h for h in hooks if "情绪转折" in h), "")
        hook_type = next((h.split("：", 1)[0] for h in hooks if "：" in h), "")
        outline.append({
            "episode": ep,
            "title": info["title"],
            "scene": scene,
            "key_props": prop,
            "expose_state": expose,
            "t0_known": t0,
            "hook_type": hook_type,
            "emotion_chain": emo_chain,
            "hook_checks": hooks,
        })
    # 核心冲突 = t0_known（主角已知，最接近"核心冲突/信息差"语义，verbatim）
    assets.append(asset_row(
        name="她从深渊归来 - story_framework",
        type_="story", subtype="story_framework",
        prompt=("20集竖屏重生复仇短剧《她从深渊归来》故事框架。L1直接反击(Ep1-5)→"
                "L2反击联盟(Ep6-10)→L3发现真凶(Ep11-16)→L4放弃前世记忆以现时能力取胜(Ep17-20)。"
                "信息差博弈驱动，每集含3秒开场钩、≥3次情绪转折、结尾未完成帧锁。"),
        meta={
            "total_episodes": 20,
            "layers": ["L1 Ep1-5 直接反击", "L2 Ep6-10 反击联盟",
                       "L3 Ep11-16 发现真凶", "L4 Ep17-20 现时能力取胜"],
            "episodes": outline,
            "storyboard_appendix": sb_appendix,   # 分镜附录/文档说明（verbatim）
        },
    ))

    # ── 3. script（20集分集剧本）──────────────────────────────────
    for ep in sorted(eps_script):
        info = eps_script[ep]
        body = info["body"]
        scene = extract_field(body, "场景")
        prop = extract_field(body, "关键道具")
        t0 = extract_field(body, "T0主角已知")
        sb_body = eps_sb.get(ep, "")
        # 场景描述概要 prompt（verbatim 字段拼接）
        prompt_parts = [f"第{ep}集「{info['title']}」"]
        if scene:
            prompt_parts.append(f"场景：{scene}")
        if prop:
            prompt_parts.append(f"关键道具：{prop}")
        if t0:
            prompt_parts.append(t0)
        prompt = "。".join(prompt_parts)
        meta = {
            "episode": ep,
            "title": info["title"],
            "content": body,                       # 完整剧本（verbatim）
            "scene": scene,
            "key_props": prop,
            "expose_state": extract_field(body, "暴露状态"),
            "hook_checks": extract_hook_lines(body),
        }
        if sb_body:
            meta["storyboard_detail"] = sb_body    # 分镜脚本（verbatim）
        assets.append(asset_row(
            name=f"她从深渊归来 Ep{ep} 剧本",
            type_="script", subtype="episode_script",
            prompt=prompt,
            meta=meta,
        ))

    # ── 4. character-bible（8 角色设定集）────────────────────────
    for cname, (cid, role, age) in CHAR_CANON.items():
        vprefix = vis_map.get(cname, "")
        vprofile = voc_map.get(cname, "")
        assert vprefix, f"视觉锚点缺失: {cname}"
        assert vprofile, f"音色设定缺失: {cname}"
        assets.append(asset_row(
            name=f"{cname} - character_bible",
            type_="character", subtype="character_bible",
            character_id=cid,
            prompt=vprefix,                        # 视觉锚点前缀（生成用）
            meta={
                "visual_prefix": vprefix,
                "voice_profile": vprofile,
                "age": age,
                "role": role,
                "description": vprefix,
            },
        ))

    # ── 5. scene-design（22 场景美术设定）────────────────────────
    for r in sce[1:]:
        name_full = clean_cell(r[0])
        scene_name = name_full.split("\n")[0].strip()
        ep_occurrence = "\n".join(name_full.split("\n")[1:]).strip()
        layout = clean_cell(r[1])
        vstyle = clean_cell(r[2])
        light = clean_cell(r[3])
        props = clean_cell(r[4])
        ai_prefix = clean_cell(r[5])
        assert ai_prefix, f"AI锚点缺失: {scene_name}"
        assets.append(asset_row(
            name=f"{scene_name} - scene_design",
            type_="scene", subtype="scene_design",
            prompt=ai_prefix,                      # 英文 AI 生成锚点前缀（原样）
            meta={
                "scene_name": scene_name,
                "episode_occurrence": ep_occurrence,
                "layout": layout,
                "visual_style": vstyle,
                "lighting": light,
                "props": props,
                "ai_prefix": ai_prefix,
            },
        ))

    # ── 6. costume-design（分场服化道，按行）─────────────────────
    # 集列 forward-fill（首行标 Ep，后续空行继承）；清理 <p"> 残片。
    cur_ep = ""
    for r in cos[1:]:
        ep_raw = clean_cell(r[0])
        if ep_raw:
            cur_ep = ep_raw
        scene = clean_cell(r[1])
        cname = clean_cell(r[2])
        costume = clean_cell(r[3])
        makeup = clean_cell(r[4])
        prop = clean_cell(r[5])
        if not cname:
            continue
        cid = CHAR_CANON.get(cname, (None,))[0]
        prompt = f"{cname} · {costume}" if costume else f"{cname} · {scene}"
        assets.append(asset_row(
            name=f"{cur_ep} {scene} · {cname} 服化道",
            type_="character", subtype="costume_design",
            character_id=cid,
            is_primary=0,                          # 分场变体，避免污染角色衣柜主视图
            prompt=prompt,
            meta={
                "episode": cur_ep,
                "scene": scene,
                "character": cname,
                "costume": costume,
                "makeup": makeup,
                "props": prop,
            },
        ))

    # ── 7. voice-profile（全剧音色设定总谱，含旁白）──────────────
    voice_doc = "\n\n".join(f"【{char_key(r[0])}】\n{r[1]}" for r in voc[1:])
    assets.append(asset_row(
        name="她从深渊归来 - voice_profile",
        type_="voice", subtype="voice_profile",
        prompt=("全剧角色音色设定总谱：8角色（沈知意/陆衍舟/沈知瑶/程屿/沈正邦/顾鸿远/周琳/王建民）"
                "+ 旁白。含音色定位、语速节奏、情绪基调、TTS配音提示词、关键场景变体。"),
        meta={
            "characters": [char_key(r[0]) for r in voc[1:]],
            "doc": voice_doc,
        },
    ))

    # ── 8. bgm-design（全剧BGM与混音总谱）────────────────────────
    assets.append(asset_row(
        name="她从深渊归来 - bgm_design",
        type_="audio", subtype="bgm_design",
        prompt=("全剧BGM与混音总谱：主题动机表(Leitmotif)+BGM cue分段规划。"
                "音乐跨镜头连续铺陈，对白/音乐/音效统一层级规则；逐镜标注冲突时以本总谱为准。"),
        meta={"doc": bgm_text.strip()},
    ))

    print(f"[build] 资产总数 = {len(assets)}")

    # ── 同步 canvas_nodes ────────────────────────────────────────
    # 新节点全部置于画布远右空白区（既有最大 x≈16600），按类目分列、纵向堆叠，
    # 不侵入既有 P01-P13 布局。phase_index=0（已知安全相位），位置显式持久化。
    NODE_TYPE = {
        "requirement": "script", "story_framework": "script",
        "episode_script": "script", "voice_profile": "script",
        "bgm_design": "script",
        "character_bible": "asset", "costume_design": "asset",
        "scene_design": "asset",
    }
    ASSET_TYPE = {
        "requirement": "requirement", "story_framework": "outline",
        "episode_script": "episode_script", "voice_profile": "voice",
        "bgm_design": "audio", "character_bible": "character",
        "costume_design": "costume", "scene_design": "scene",
    }
    SUBTYPE_ORDER = ["requirement", "story_framework", "episode_script",
                     "character_bible", "scene_design", "costume_design",
                     "voice_profile", "bgm_design"]
    col_of = {s: i for i, s in enumerate(SUBTYPE_ORDER)}
    counters = {}

    nodes = []
    for a in assets:
        sub = json.loads(a["meta"])["subtype"]
        col = col_of.get(sub, 7)
        row = counters.get(col, 0)
        counters[col] = row + 1
        node_id = f"notion-{sub}-{PROJECT}-{len(nodes)}"
        content_summary = a["prompt"]
        data = {
            "label": a["name"],
            "type": NODE_TYPE[sub],
            "assetType": ASSET_TYPE[sub],
            "subtype": sub,
            "source": "notion",
            "phaseGroup": "notion_docs",
            "description": content_summary[:200],
            "state": "success",
            "tags": ["notion-import"],
        }
        nodes.append({
            "id": node_id,
            "project_id": PROJECT,
            "episodes_id": EP,
            "type": NODE_TYPE[sub],
            "branch_id": "main",
            "phase_index": 0,
            "phase_name": "P20 · Notion创作文档",
            "position_x": 17200.0 + col * 340.0,
            "position_y": 200.0 + row * 240.0,
            "size_width": 300.0,
            "size_height": 200.0,
            "data": json.dumps(data, ensure_ascii=False),
            "state": "success",
            "is_winner": 0,
            "created_at": NOW,
            "updated_at": NOW,
        })
    print(f"[build] canvas_nodes = {len(nodes)}")

    # ── 写库 ─────────────────────────────────────────────────────
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys=OFF")
    cur = conn.cursor()

    # 仅清理本脚本历史导入（可重入），不影响其它资产
    cur.execute("DELETE FROM o_assets WHERE projectId=? AND createdBy=?",
                (PROJECT, CREATED_BY))
    cur.execute("DELETE FROM canvas_nodes WHERE project_id=? AND id LIKE 'notion-%'",
                (PROJECT,))
    print(f"[clean] 历史 notion-import: o_assets/canvas_nodes 已清理")

    # 取当前最大 id 作为新 id 起点
    cur.execute("SELECT COALESCE(MAX(id),0) FROM o_assets")
    next_id = cur.fetchone()[0] + 1

    asset_cols = ["name", "prompt", "type", "projectId", "episodesId",
                  "characterId", "viewAngle", "isPrimaryView", "state", "tags",
                  "meta", "createdAt", "createdBy"]
    asset_id_by_idx = []
    for a in assets:
        a["id"] = next_id
        asset_id_by_idx.append(next_id)
        next_id += 1
        cur.execute(
            f"INSERT INTO o_assets (id,{','.join(asset_cols)}) "
            f"VALUES ({','.join(['?']*(len(asset_cols)+1))})",
            [a["id"]] + [a.get(c) for c in asset_cols],
        )

    node_cols = ["id", "project_id", "episodes_id", "type", "branch_id",
                 "phase_index", "phase_name", "position_x", "position_y",
                 "size_width", "size_height", "data", "state", "is_winner",
                 "created_at", "updated_at"]
    # 把 assetId 回填到 node.data，建立 node→o_assets 关联
    for n, aid in zip(nodes, asset_id_by_idx):
        d = json.loads(n["data"])
        d["assetId"] = aid
        n["data"] = json.dumps(d, ensure_ascii=False)
        cur.execute(
            f"INSERT INTO canvas_nodes ({','.join(node_cols)}) "
            f"VALUES ({','.join(['?']*len(node_cols))})",
            [n[c] for c in node_cols],
        )

    conn.commit()

    # ── 统计 ─────────────────────────────────────────────────────
    cur.execute("""SELECT json_extract(meta,'$.subtype') st, type, COUNT(*)
                   FROM o_assets WHERE projectId=? AND createdBy=?
                   GROUP BY st ORDER BY st""", (PROJECT, CREATED_BY))
    print("\n[result] 新增 o_assets 明细 (subtype | type | count):")
    for st, tp, cnt in cur.fetchall():
        print(f"   {st:<18} | {tp:<12} | {cnt}")
    cur.execute("SELECT COUNT(*) FROM o_assets WHERE projectId=? AND createdBy=?",
                (PROJECT, CREATED_BY))
    print(f"[result] 新增 o_assets 合计 = {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM canvas_nodes WHERE project_id=? AND id LIKE 'notion-%'",
                (PROJECT,))
    print(f"[result] 新增 canvas_nodes 合计 = {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM o_assets WHERE projectId=?", (PROJECT,))
    print(f"[result] 项目 o_assets 总数 = {cur.fetchone()[0]}")

    # 校验：无空 prompt
    cur.execute("SELECT COUNT(*) FROM o_assets WHERE projectId=? AND createdBy=? AND (prompt IS NULL OR prompt='')",
                (PROJECT, CREATED_BY))
    empty = cur.fetchone()[0]
    assert empty == 0, f"存在 {empty} 条空 prompt！"
    print("[check] 所有新增资产 prompt 均非空 ✓")

    conn.close()
    print("\nDONE")


if __name__ == "__main__":
    main()

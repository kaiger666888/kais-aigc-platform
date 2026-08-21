---
phase: 56-creative-visualization
plan: 02
subsystem: theater-engines
tags: [viz-02, viz-03, theater-shell, audio-peaks, transcript-align]
requires: []
provides:
  - TheaterShell(theater/ 目录;背板关/头栏 icon+title+subtitle+headerExtra 槽/theaterBtnStyle+theaterCloseBtnStyle 导出;Esc 归消费者)
  - audioPeaks:computePeaksFromSamples(分桶 max|sample| 全局归一)/pseudoPeaks(FNV-1a+xorshift [0.15,1.0])/resolvePeaks(never-throws 三态 + FIFO 缓存 128)
  - transcriptAlign:splitSentences(标点/换行切分保标点,空→(无转写))/evenAlign(字符数加权,近似对齐契约注释)/sentenceAt(钳制)
affects: [56-04 组视图剧场, 56-05 G16 双轨]
key-decisions:
  - decision: decode 缺省 lazy AudioContext + ctx.close();仅在 browser 未注入时
    rationale: node 测试注入 decode;浏览器资源即用即还。
  - decision: 短音频 bucketSize max(1,floor) 兜底(末桶可越界钳到 length)
    rationale: samples<buckets 不抛异常是契约。
requirements-completed: []
duration: 25 min
completed: 2026-08-22T07:05:00+08:00
---

# Phase 56 Plan 02: 剧场壳与音频引擎 Summary

TheaterShell 家族壳(背板关+头栏槽+按钮样式导出;墙零改动)+ audioPeaks(真峰/伪波形/缓存,8 用例)+ transcriptAlign(分句/加权/定位,5 用例);354/354。

**Tasks:** 3/3(TDD ×2)· **Files:** 5 · VariantWall git diff 0;零新依赖(wavesurfer 否决)。

**Deviations:** ①evenAlign 测试首版比较方向反(dLong/dShort 更名修正);②theaterBtnStyle 深字 #0A0B0E→v3theme.surface.canvas(零裸 hex 纪律)。auto-fixed。

---

Ready for Wave 2(56-03 VIZ-01 角标/popover;56-04 VIZ-02 组视图剧场)。

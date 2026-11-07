---
doc_id: fusion-code/guide
product: fusion-code
class: app
entry: guided-ui
doc_type: guide
title: { zh: "fusion-code 架构合规说明", en: "fusion-code architecture compliance" }
audience: engineer
status: draft
version: 0.5.22
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - ARCHITECTURE_COMPLIANCE.md
---

# 架构合规整改计划

> 审计日期: 2026-08-02
> 关联 Issue: #27
> 违规等级: P2
> 合规评级: B+

## 层级定位

**三、基础核心产品** — 本地化代码智能体

核心职责：代码补全、重构、问答。

## 违规项与整改

| # | 违规项 | 整改方案 | 截止 |
|---|--------|----------|------|
| 1 | model-router 模型选择策略属网关层 | 抽取策略接口，本地模式保留默认映射作 fallback | P2-S1 |
| 2 | offline-mode 主动 ping 判断推理可用性 | 改为监听 fusion-mlx 健康状态事件 | P2-S2 |

## 合规标准

- 产品层只声明 TaskComplexity，不做模型路由
- 基础设施状态通过事件监听获取

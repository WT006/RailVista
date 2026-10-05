# 全国景点 POI 补充记录（2026-10-03）

## 变更结果

- 以远端 `main` 为基线，原主库有 624 个景点；新增 136 个，生成后共 760 个。
- 候选清单有 145 个地点；生成时排除 9 个与已有点重名或相距不足 500 米的条目。
- 新增点覆盖 31 个中国大陆省级行政区。
- 新增记录沿用景点 v3 结构，包含 `id`、`name`、WGS84 `lng/lat`、`intro`、`visibility`、`category`、`subtype`、`dimensions`、`sources`、`verification` 和 `province` 等字段。
- 所有新增说明为 40–51 个汉字，符合项目 v3 的 40–90 字校验，也满足本批次 20–60 字的简短描述目标。
- 新增记录标为 `distant`，距离阈值为 35 公里。`bestView.note` 明确说明从具体车次和地形判断可见性；没有把景点位置描述成已确认的车窗视线。

## 修改文件

- `data/presets/scenic-spots.json`：策展生成后的主景点库。
- `data/presets/scenic-spots-supplement-20261002.json`：本批次 145 个候选 POI 及其来源和核验字段。
- `scripts/build-scenic-national-batch-20261002.mjs`：生成本批次补充数据的可重复脚本。
- `scripts/build-scenic-spots-curated.mjs`：读取新补充数据；新增批次按 ID、名称或 500 米内坐标重合去重；将主库更新时间更新到 2026-10-03。

旧批次的 8 公里去重规则保留。新批次将近邻距离缩到 500 米，避免把同城不同景点（例如历史街区和博物馆）误合并。景点主库仍由 `scripts/build-scenic-spots-curated.mjs` 生成。

## 数据来源和限制

每条新增记录均附有中文百科地点页和 OpenStreetMap 名称检索链接，并使用 `probable` 状态。坐标按地点实体的 WGS84 经纬度入库；旅游点名称、实体位置和官方介绍可以通过记录中的来源链接复核。景点是否落在某次行程的铁路缓冲区内仍由现有沿线筛选逻辑决定。

本次只扩充景点数据和策展生成流程，没有修改地图 UI、地图框架、API、导航或数据库。项目地图按行程铁路折线筛选沿线景点，因此本次数据不会单独开启一层不受行程约束的全国全量 Marker 图层。

## 验证

- JSON 解析成功；策展生成器成功输出 760 条记录。
- ID 唯一；新增记录无同名项；经纬度均通过中国范围检查；新增记录的省份、分类、来源和说明字段检查通过。
- 共享包 174 项测试通过（174 passed，0 failed）；共享包、API TypeScript 编译和 Web `vue-tsc` 检查通过；Vite 生产构建通过。
- 根目录 `pnpm test` 的安装前置流程被仓库现有 `allowBuilds` 策略拦截（`esbuild` 尚未获准执行安装脚本）。为验证项目代码，直接调用已安装的本地测试、TypeScript 和 Vite 工具完成上述检查；构建只有两条现有动态/静态导入分包提示。

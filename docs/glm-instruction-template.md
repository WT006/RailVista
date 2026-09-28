# GLM 指令模板（硬化版）

> 每条任务必须包含以下四要素，禁止以 tsc/build/单测替代端到端验收。

## 模板结构

```
任务：<任务标题>
①精确文件与函数：<file_path>:<line_number> <function_name>
②可执行验收命令：<command>
③预期输出样例：<expected_output>
④禁止以 tsc/build/单测替代端到端验收，交付必须粘贴实测输出
```

## 走廊重做指令模板

```
任务：重做走廊 <corridor_id>
①精确文件与函数：data/presets/corridors/<corridor_id>.json + scripts/rebuild-corridor.mjs
②可执行验收命令：node scripts/rebuild-corridor.mjs --id <corridor_id> && node scripts/patrol-data.mjs --strict
③预期输出样例：Written <corridor_id>: N points / PATROL: ... alerts=0 (WARN=0)
④禁止以 tsc/build/单测替代端到端验收，交付必须粘贴实测输出
```

## 路线修复指令模板

```
任务：修复路线 <train_code> <from>→<to>
①精确文件与函数：apps/api/src/services/localRails.ts:<line> <function>
②可执行验收命令：node scripts/audit-routes.mjs --train <train_code> --from <from> --to <to>
③预期输出样例：[1/1] <train_code> <from>→<to> ... corridor/network (N/N seg)
④禁止以 tsc/build/单测替代端到端验收，交付必须粘贴实测输出
```

## 站坐标补齐指令模板

```
任务：补齐站坐标 <station_name>
①精确文件与函数：data/stations-geo.json + scripts/seed-stations-geo-full.mjs
②可执行验收命令：node scripts/seed-stations-geo-full.mjs --all && node scripts/patrol-data.mjs --strict
③预期输出样例：Done: added=N / PATROL: ... coverage >= 99%
④禁止以 tsc/build/单测替代端到端验收，交付必须粘贴实测输出
```
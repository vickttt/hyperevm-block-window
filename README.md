# HyperEVM 测试网区块核对 0.2.1

对照两份 HyperEVM 测试网区块快照，找出未覆盖的高度、窗口内缺块、哈希差异和字段不一致。文件在浏览器本地处理，可以导出对照包供同事离线重算。

## 离线试用

1. 下载并解压 [0.2.1 离线包](https://github.com/vickttt/hyperevm-block-window/releases/tag/v0.2.1)，或下载本仓库源码后解压，用 Chrome 打开 `index.html`。
2. 在「按高度对照两份快照」中选 `demo/01-reference.json` 和 `demo/02-recheck.csv`，点击「对照快照」。应显示 8 个匹配、0 个差异。
3. 点击「导出可复现对照包」，再从「复现别人分享的对照」打开导出的文件。也可直接导入 `demo/03-replay.json`。页面会重新计算差异。

基准支持连续 JSON 快照。待查支持同格式 JSON 或 1–64 条记录的 UTF-8 CSV。CSV 表头顺序如下。

```csv
chainId,capturedAt,number,timestamp,gasLimit,hash,parentHash
```

`chainId` 为 `998`，同一份 CSV 各行使用同一个 ISO UTC 取证时间。高度、Unix 秒级区块时间和 Gas 上限接受十进制整数或十六进制整数。哈希为 `0x` 后接 64 位十六进制字符。页面对照输入文件，不能用来判定链重组、共识或最终性。

开发验证可执行 `node --test window.test.cjs`。网页本身没有第三方运行依赖。

## 数据来源和许可

真实样例来自 HyperEVM 官方测试网 RPC，链 ID 998，高度 69038317–69038324。两份样例分别采集于 2026-11-08 03:53:46 和 04:26:24 UTC，属于同源跨时间复核。「试用带差异的示例」是人工删改的反例。官方原始区块数据文档说明公开数据可供使用，并列举开发工具用途。随附样例仅包含对照所需的区块字段。 [官方 RPC 文档](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc) · [官方数据说明](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/raw-hyperevm-block-data)

本仓库公开源码供查看和复现。本次发布未附加开源许可证。样例来源及适用条件以上游说明为准。 [GitHub 关于公开仓库许可的说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)

发布 ZIP 的 SHA-256 为 `798a8425e5f829e2c106f0312ad92671d72a0f7e58796fd8adde671b143450fe`。

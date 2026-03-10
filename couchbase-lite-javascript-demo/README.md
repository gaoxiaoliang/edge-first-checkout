# Couchbase Lite JavaScript Demo

这是一个使用 Couchbase Lite JavaScript SDK 的演示项目，展示了如何在浏览器中进行 CRUD 操作并与 Couchbase Capella App Services 同步。

## 功能

1. **新增 Transaction** - 添加一条 type 为 transaction 的数据
2. **删除 Transaction** - 根据 transaction_id 删除数据
3. **更新 Transaction** - 根据 transaction_id 更新 total_amount 字段
4. **分页查询** - 分页显示所有 type 为 transaction 的数据

## 运行方式

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

浏览器会自动打开 http://localhost:3000

## 配置信息

- **App Service URL**: `wss://j9hcqxmzo6gklypg.apps.cloud.couchbase.com/ica-checkout-app-service`
- **Bucket**: `Ica-demo`
- **Collection**: `_default`

## 数据结构

每条 transaction 数据包含以下字段：

```json
{
  "type": "transaction",
  "transaction_id": "txn_xxx",
  "total_amount": 100.00,
  "description": "描述信息",
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

## 注意事项

1. Couchbase Lite JavaScript 将数据存储在浏览器的 IndexedDB 中
2. 数据会自动与 Couchbase Capella App Services 进行双向同步
3. 需要确保网络可以访问 App Service 的 WebSocket 端点
4. 首次运行时可能需要等待几秒钟让同步完成

## 在 Couchbase Shell 中验证数据

```bash
# 查询 transaction 数据
query "select * from \`Ica-demo\` where type = 'transaction' order by transaction_id desc limit 10"
```

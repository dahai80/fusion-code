// e2e 辅助源: 供浏览器跨源测试用的第二 origin (真实 CORS 路径需要非同源页面)。
// 仅测试期由 Playwright webServer 拉起; 11496 未占用 (port-registry 无登记, 测试夹具不注册)。
import { serve } from "bun";

serve({
	port: 11496,
	fetch() {
		return new Response(
			"<!DOCTYPE html><html><body>fusion-code e2e fixture origin</body></html>",
			{ headers: { "Content-Type": "text/html" } },
		);
	},
});

console.log("fixture-origin-server on 11496");

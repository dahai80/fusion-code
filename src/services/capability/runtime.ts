// P5.5 能力清单 (Typert 类型图) — 运行期门控 (enhance-0819.md §D.7 P5.5)。
//
// 评估而非照搬: 仅落地「从工具/技能/插件定义生成类型图」的纯导出函数 +
// fast-path 子命令。RPC 网关远程控制面 (安全面) 显式 defer。
// 双门禁: feature("CAPABILITY_MANIFEST") 编译期 (cli.tsx 内 if) +
// FUSION_CODE_CAPABILITY_MANIFEST_ENABLED=1 运行期 (此处 + cli handler)。
// 默认 off → byte-identical, 零运行时影响。

export function isCapabilityManifestEnabled(): boolean {
	return process.env.FUSION_CODE_CAPABILITY_MANIFEST_ENABLED === "1";
}

// 清单导出选项 (注入 cwd + 时间戳, 便于单测 + 避免在纯函数内取环境)。
export interface CapabilityManifestOptions {
	cwd: string;
	// 调用方传入时间戳 (ISO), 纯函数不自己取 Date — 便于测试确定性。
	generatedAt?: string;
	// 是否包含技能/插件 (默认 true; 关闭则只导出工具, 降体积)。
	includeSkills?: boolean;
	includePlugins?: boolean;
	// 是否序列化 inputSchema (JSON Schema); 默认 true。关闭则只导出名称图, 极简。
	includeSchemas?: boolean;
}

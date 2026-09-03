/**
 * Minimal pi extension example.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const helloTool = defineTool({
  name: "hello",
  label: "Hello",
  description: "Greet someone by name.",
  parameters: Type.Object({
    name: Type.String({ description: "Name to greet" }),
  }),

  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Hello, ${params.name}!` }],
      details: { greeted: params.name },
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(helloTool);

  pi.registerCommand("my-pi", {
    description: "Show my-pi extension status.",
    handler: async (_args, ctx) => {
      ctx.ui.notify("my-pi extension is loaded.", "info");
    },
  });
}

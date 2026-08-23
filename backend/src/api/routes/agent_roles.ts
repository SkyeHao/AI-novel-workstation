/**
 * Agent 角色蓝图 API 路由
 */
import type { FastifyInstance } from "fastify";
import {
  listAgentRoles,
  getAgentRole,
  createAgentRole,
  updateAgentRole,
  deleteAgentRole,
  duplicateAgentRole,
  type AgentRoleAsset,
} from "../../assets/agent_roles.js";

export async function agentRolesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/agent-roles - List all roles
  app.get("/", async () => {
    return listAgentRoles();
  });

  // GET /api/agent-roles/:id - Get single role
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const role = getAgentRole(req.params.id);
    if (!role) return reply.code(404).send({ error: "角色不存在" });
    return role;
  });

  // POST /api/agent-roles - Create new role
  app.post<{ Body: Partial<AgentRoleAsset> }>("/", async (req, reply) => {
    const body = req.body ?? {};
    const required = ["name", "description", "category", "systemPrompt"];
    for (const k of required) {
      if (!body[k as keyof typeof body]) {
        return reply.code(400).send({ error: `缺少字段: ${k}` });
      }
    }
    
    const role = createAgentRole({
      name: String(body.name),
      description: String(body.description),
      category: body.category as "proposer" | "synthesizer" | "reviewer",
      systemPrompt: String(body.systemPrompt),
      promptVariables: body.promptVariables as string[] | undefined,
      modelConfig: body.modelConfig ?? {
        mode: "reference",
      },
      contextConfig: body.contextConfig ?? {
        sharedContextKeys: [],
        roleFocusHint: "",
      },
    });
    return role;
  });

  // PUT /api/agent-roles/:id - Update role
  app.put<{ Params: { id: string }; Body: Partial<AgentRoleAsset> }>("/:id", async (req, reply) => {
    const role = updateAgentRole(req.params.id, req.body ?? {});
    if (!role) return reply.code(404).send({ error: "角色不存在或为内置角色不可修改" });
    return role;
  });

  // DELETE /api/agent-roles/:id - Delete role
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ok = deleteAgentRole(req.params.id);
    if (!ok) return reply.code(404).send({ error: "角色不存在或为内置角色不可删除" });
    return { success: true };
  });

  // POST /api/agent-roles/:id/duplicate - Duplicate role
  app.post<{ Params: { id: string } }>("/:id/duplicate", async (req, reply) => {
    const role = duplicateAgentRole(req.params.id);
    if (!role) return reply.code(404).send({ error: "角色不存在" });
    return role;
  });
}


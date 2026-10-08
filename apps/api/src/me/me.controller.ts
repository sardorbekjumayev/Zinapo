import { Body, Controller, ForbiddenException, Get, HttpCode, Put } from '@nestjs/common';
import { Actor, CurrentActor, Guarded } from '../authz';
import { MeService } from './me.service';
import { SetWorkspaceDto, UpdateMeDto } from './dto/update-me.dto';

/**
 * task.md § 6.1 — "Me & workspaces".
 *
 * `GET /api/me` is what the dashboard router reads to decide where to send
 * someone (§ 2.2), so it has to be cheap: the Actor behind it is one query,
 * cached 60 s.
 */
@Controller('me')
@Guarded()
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  async get(@CurrentActor() actor: Actor) {
    return this.me.describe(actor);
  }

  @Put()
  async update(@CurrentActor() actor: Actor, @Body() dto: UpdateMeDto) {
    return this.me.updateProfile(actor, dto);
  }

  @Put('workspace')
  @HttpCode(200)
  async setWorkspace(@CurrentActor() actor: Actor, @Body() dto: SetWorkspaceDto) {
    const ok = await this.me.setWorkspace(actor, dto.workspace);
    // Not a 404: the workspace route exists, the actor just does not hold it.
    if (!ok) {
      throw new ForbiddenException({
        error: 'WORKSPACE_FORBIDDEN',
        details: { workspace: dto.workspace },
      });
    }
    return { ok: true, workspace: dto.workspace };
  }
}

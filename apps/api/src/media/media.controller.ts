import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Actor, CurrentActor, Guarded, RequireStaffRole } from '../authz';
import { MediaKind, MediaService, UploadedFile as MediaFile } from './media.service';
import { MediaInvalidException } from '../bank/bank.errors';

/** `POST /api/staff/media` — authors and bank editors upload item images and audio. */
@Controller('staff/media')
@Guarded()
export class MediaUploadController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @RequireStaffRole('item_author', 'bank_editor')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024, files: 1 } }))
  upload(
    @CurrentActor() actor: Actor,
    @UploadedFile() file: MediaFile | undefined,
    @Body('kind') kind: string,
  ) {
    if (kind !== 'image' && kind !== 'audio') throw new MediaInvalidException('kind');
    return this.media.upload(actor, kind as MediaKind, file);
  }
}

/**
 * `GET /api/media/:kind/:file?exp&sig` — the signed link is the authorisation,
 * so this route has no session guard: kid mode on a shared device (M4) and an
 * `<img>` tag both just follow the link.
 */
@Controller('media')
export class MediaReadController {
  constructor(private readonly media: MediaService) {}

  @Get(':kind/:file')
  async read(
    @Param('kind') kind: string,
    @Param('file') file: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    if (!/^(image|audio)$/.test(kind) || !/^[0-9a-f-]{36}\.(png|jpg|svg|mp3)$/.test(file)) {
      throw new NotFoundException({ error: 'NOT_FOUND' });
    }
    const found = await this.media.read(`${kind}/${file}`, exp ?? '', sig ?? '');
    if (!found) throw new NotFoundException({ error: 'NOT_FOUND' });

    res.setHeader('Content-Type', found.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // An SVG is a document: sandbox it so a script inside can never run on our origin.
    if (found.mime === 'image/svg+xml') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }
    res.end(found.body);
  }
}

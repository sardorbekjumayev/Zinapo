import { Global, Module } from '@nestjs/common';
import { join } from 'path';
import { MediaService } from './media.service';
import { LocalDiskStorage, MEDIA_STORAGE } from './media.storage';
import { MediaReadController, MediaUploadController } from './media.controller';

/**
 * Media storage (task.md § 0, in-country object storage). The driver is chosen
 * here and nowhere else; `MEDIA_DIR` points the local driver at a volume.
 */
@Global()
@Module({
  controllers: [MediaUploadController, MediaReadController],
  providers: [
    MediaService,
    {
      provide: MEDIA_STORAGE,
      useFactory: () => new LocalDiskStorage(process.env.MEDIA_DIR || join(process.cwd(), '.media')),
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}

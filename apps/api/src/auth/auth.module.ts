import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { LoginRequestService } from './login-request.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [LoginRequestService, OtpService, SessionService],
  exports: [LoginRequestService, OtpService, SessionService],
})
export class AuthModule {}

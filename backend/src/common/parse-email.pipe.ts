import { Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { badRequest } from './errors';
import { flattenValidationErrors, IsAsciiEmail, NormalizeEmail } from './validation';

// The decorators of the request bodies, so the path and the body accept exactly the same addresses (spec 4.4).
class EmailParam {
  @NormalizeEmail() @IsAsciiEmail()
  email!: string;
}

// Email is the only string path parameter of the API (BEVN-203). Express has already decoded it: %40 -> @, + stays +.
@Injectable()
export class ParseEmailPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const param = plainToInstance(EmailParam, { email: value });
    const errors = validateSync(param, { validationError: { target: false, value: false } });
    if (errors.length > 0) throw badRequest('Invalid email', flattenValidationErrors(errors));
    return param.email;
  }
}

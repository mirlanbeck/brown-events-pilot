import { Injectable, PipeTransform } from '@nestjs/common';
import { badRequest } from './errors';
import { INT32_MAX } from './limits';

const ID = /^[1-9][0-9]{0,9}$/;

@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = ID.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(id) || id > INT32_MAX) {
      throw badRequest('Invalid id', [{ field: 'id', messages: [`id must be an integer between 1 and ${INT32_MAX}`] }]);
    }
    return id;
  }
}

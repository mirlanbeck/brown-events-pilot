import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

@Injectable()
class Dependency {
  value(): string {
    return 'resolved';
  }
}

@Injectable()
class Consumer {
  constructor(private readonly dependency: Dependency) {}
  read(): string {
    return this.dependency.value();
  }
}

describe('decorator metadata (TS 6 + Nest 12 ESM packages under Jest)', () => {
  it('injects a dependency by its constructor type', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [Dependency, Consumer] }).compile();
    expect(moduleRef.get(Consumer).read()).toBe('resolved');
  });
});

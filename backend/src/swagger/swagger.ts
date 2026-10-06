import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { Request } from 'express';
import { API_DESCRIPTION } from './api-description';

export function buildSwaggerDocument(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle('BrownEvents API').setVersion('v1').setDescription(API_DESCRIPTION).build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: NestExpressApplication): void {
  SwaggerModule.setup('swagger', app, buildSwaggerDocument(app), {
    jsonDocumentUrl: 'swagger/v1/swagger.json', // the .NET path, kept for clients generated from it (spec 5.8)
    customSiteTitle: 'BrownEvents API',
    // Advertise the host the document was requested from, as Program.cs:76-81 did, so "Try it out" hits the same server.
    patchDocumentOnRequest: (req: unknown, _res: unknown, document: OpenAPIObject) => {
      const request = req as Request; // Express request; the option is typed generically in @nestjs/swagger 12
      return { ...document, servers: [{ url: `${request.protocol}://${request.get('host') ?? ''}` }] };
    },
  });
}

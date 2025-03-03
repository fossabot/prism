import { createLogger } from '@stoplight/prism-core';
import { IHttpOperation, INodeExample } from '@stoplight/types';
import { right } from 'fp-ts/lib/Either';
import { reader } from 'fp-ts/lib/Reader';
import { flatMap } from 'lodash';
import { assertRight } from '../../__tests__/utils';
import { HttpMocker } from '../../mocker';
import * as JSONSchemaGenerator from '../../mocker/generator/JSONSchema';
import { JSONSchema } from '../../types';
import helpers from '../negotiator/NegotiatorHelpers';

const logger = createLogger('TEST', { enabled: false });

describe('HttpMocker', () => {
  const httpMocker = new HttpMocker();

  afterEach(() => jest.restoreAllMocks());

  describe('mock()', () => {
    const mockSchema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        surname: { type: 'string', format: 'email' },
      },
      required: ['name', 'email'],
    };

    const mockResource: IHttpOperation = {
      id: 'id',
      method: 'get',
      path: '/test',
      request: {},
      responses: [
        {
          code: '200',
          headers: [],
          contents: [
            {
              mediaType: 'application/json',
              schema: mockSchema,
              examples: [
                {
                  key: 'preferred key',
                  value: 'hello',
                },
                {
                  key: 'test key',
                  value: 'test value',
                },
                {
                  key: 'test key2',
                  externalValue: 'http://example.org/examples/example1',
                },
              ],
              encodings: [],
            },
          ],
        },
      ],
    };

    const mockInput = {
      validations: {
        input: [],
      },
      data: {
        method: 'get' as const,
        url: {
          path: '/test',
          baseUrl: 'example.com',
        },
      },
    };

    describe('with valid negotiator response', () => {
      it('returns an empty body when negotiator did not resolve to either example nor schema', () => {
        jest
          .spyOn(helpers, 'negotiateOptionsForValidRequest')
          .mockReturnValue(reader.of(right({ code: '202', mediaType: 'test', headers: [] })));

        const mockResult = httpMocker.mock({
          resource: mockResource,
          input: mockInput,
        })(logger);

        assertRight(mockResult, result => expect(result).toHaveProperty('body', undefined));
      });

      it('returns static example', () => {
        jest.spyOn(helpers, 'negotiateOptionsForValidRequest').mockReturnValue(
          reader.of(
            right({
              code: '202',
              mediaType: 'test',
              bodyExample: mockResource.responses![0].contents![0].examples![0],
              headers: [],
            }),
          ),
        );

        const mockResult = httpMocker.mock({
          resource: mockResource,
          input: mockInput,
        })(logger);

        assertRight(mockResult, result => expect(result).toMatchSnapshot());
      });

      it('returns dynamic example', () => {
        jest.spyOn(helpers, 'negotiateOptionsForValidRequest').mockReturnValue(
          reader.of(
            right({
              code: '202',
              mediaType: 'test',
              schema: mockResource.responses![0].contents![0].schema,
              headers: [],
            }),
          ),
        );

        const response = httpMocker.mock({
          resource: mockResource,
          input: mockInput,
        })(logger);

        assertRight(response, result => {
          return expect(result).toHaveProperty('body', {
            name: expect.any(String),
            surname: expect.any(String),
          });
        });
      });
    });

    describe('with invalid negotiator response', () => {
      it('returns static example', () => {
        jest.spyOn(helpers, 'negotiateOptionsForInvalidRequest').mockReturnValue(
          reader.of(
            right({
              code: '202',
              mediaType: 'test',
              bodyExample: mockResource.responses![0].contents![0].examples![0],
              headers: [],
            }),
          ),
        );

        const mockResult = httpMocker.mock({
          resource: mockResource,
          input: Object.assign({}, mockInput, { validations: { input: [{}] } }),
        })(logger);

        assertRight(mockResult, result => expect(result).toMatchSnapshot());
      });
    });

    describe('when example is of type INodeExternalExample', () => {
      it('generates a dynamic example', () => {
        jest.spyOn(helpers, 'negotiateOptionsForValidRequest').mockReturnValue(
          reader.of(
            right({
              code: '202',
              mediaType: 'test',
              bodyExample: mockResource.responses![0].contents![0].examples![1],
              headers: [],
              schema: { type: 'string' },
            }),
          ),
        );

        jest.spyOn(JSONSchemaGenerator, 'generate').mockReturnValue('example value chelsea');

        const mockResult = httpMocker.mock({
          resource: mockResource,
          input: mockInput,
        })(logger);

        assertRight(mockResult, result => expect(result).toMatchSnapshot());
      });
    });

    describe('when an example is defined', () => {
      describe('and dynamic flag is true', () => {
        describe('should generate a dynamic response', () => {
          const generatedExample = { hello: 'world' };

          beforeAll(() => {
            jest.spyOn(JSONSchemaGenerator, 'generate').mockReturnValue(generatedExample);
            jest.spyOn(JSONSchemaGenerator, 'generateStatic');
          });

          afterAll(() => {
            jest.restoreAllMocks();
          });

          it('the dynamic response should not be an example one', async () => {
            const response = await httpMocker.mock({
              input: mockInput,
              resource: mockResource,
              config: { cors: false, mock: { dynamic: true }, validateRequest: true, validateResponse: true },
            })(logger);

            expect(JSONSchemaGenerator.generate).toHaveBeenCalled();
            expect(JSONSchemaGenerator.generateStatic).not.toHaveBeenCalled();

            const allExamples = flatMap(mockResource.responses, res =>
              flatMap(res.contents, content => content.examples || []),
            ).map(x => {
              if ('value' in x) return x.value;
            });

            assertRight(response, result => {
              expect(result.body).toBeDefined();

              allExamples.forEach(example => expect(result.body).not.toEqual(example));
              expect(result.body).toHaveProperty('hello', 'world');
            });
          });
        });
      });

      describe('and dynamic flag is false', () => {
        describe('and the response has an example', () => {
          describe('and the example has been explicited', () => {
            const response = httpMocker.mock({
              input: mockInput,
              resource: mockResource,
              config: {
                cors: false,
                mock: { dynamic: false, exampleKey: 'test key' },
                validateRequest: true,
                validateResponse: true,
              },
            })(logger);

            it('should return the selected example', () => {
              const selectedExample = flatMap(mockResource.responses, res =>
                flatMap(res.contents, content => content.examples || []),
              ).find(ex => ex.key === 'test key');

              expect(selectedExample).toBeDefined();

              assertRight(response, result => expect(result.body).toEqual((selectedExample as INodeExample).value));
            });
          });

          describe('no response example is requested', () => {
            const response = httpMocker.mock({
              input: mockInput,
              resource: mockResource,
              config: { cors: false, mock: { dynamic: false }, validateRequest: true, validateResponse: true },
            })(logger);

            it('returns the first example', () => {
              assertRight(response, result => {
                expect(result.body).toBeDefined();
                const selectedExample = mockResource.responses[0].contents![0].examples![0];

                expect(selectedExample).toBeDefined();
                expect(result.body).toEqual((selectedExample as INodeExample).value);
              });
            });
          });
        });

        describe('and the response has not an examples', () => {
          function createOperationWithSchema(schema: JSONSchema): IHttpOperation {
            return {
              id: 'id',
              method: 'get',
              path: '/test',
              request: {},
              responses: [
                {
                  code: '200',
                  headers: [],
                  contents: [
                    {
                      mediaType: 'application/json',
                      schema,
                    },
                  ],
                },
              ],
            };
          }

          function mockResponseWithSchema(schema: JSONSchema) {
            return httpMocker.mock({
              input: mockInput,
              resource: createOperationWithSchema(schema),
              config: { cors: false, mock: { dynamic: false }, validateRequest: true, validateResponse: true },
            })(logger);
          }

          describe('and the property has an example key', () => {
            const eitherResponse = mockResponseWithSchema({
              type: 'object',
              properties: {
                name: { type: 'string', examples: ['Clark'] },
              },
            });

            it('should return the example key', () =>
              assertRight(eitherResponse, response => expect(response.body).toHaveProperty('name', 'Clark')));

            describe('and also a default key', () => {
              const eitherResponseWithDefault = mockResponseWithSchema({
                type: 'object',
                properties: {
                  middlename: { type: 'string', examples: ['J'], default: 'JJ' },
                },
              });

              it('prefers the default', () =>
                assertRight(eitherResponseWithDefault, responseWithDefault =>
                  expect(responseWithDefault.body).toHaveProperty('middlename', 'JJ'),
                ));
            });

            describe('with multiple example values in the array', () => {
              const eitherResponseWithMultipleExamples = mockResponseWithSchema({
                type: 'object',
                properties: {
                  middlename: { type: 'string', examples: ['WW', 'JJ'] },
                },
              });

              it('prefers the first example', () =>
                assertRight(eitherResponseWithMultipleExamples, responseWithMultipleExamples =>
                  expect(responseWithMultipleExamples.body).toHaveProperty('middlename', 'WW'),
                ));
            });

            describe('with an empty `examples` array', () => {
              const eitherResponseWithNoExamples = mockResponseWithSchema({
                type: 'object',
                properties: {
                  middlename: { type: 'string', examples: [] },
                },
              });

              it('fallbacks to string', () =>
                assertRight(eitherResponseWithNoExamples, responseWithNoExamples =>
                  expect(responseWithNoExamples.body).toHaveProperty('middlename', 'string'),
                ));
            });
          });

          describe('and the property containing the example is deeply nested', () => {
            const eitherResponseWithNestedObject = mockResponseWithSchema({
              type: 'object',
              properties: {
                pet: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', examples: ['Clark'] },
                    middlename: { type: 'string', examples: ['J'], default: 'JJ' },
                  },
                },
              },
            });

            assertRight(eitherResponseWithNestedObject, responseWithNestedObject => {
              it('should return the example key', () =>
                expect(responseWithNestedObject.body).toHaveProperty('pet.name', 'Clark'));
              it('should still prefer the default', () =>
                expect(responseWithNestedObject.body).toHaveProperty('pet.middlename', 'JJ'));
            });
          });

          describe('and the property has not an example, but a default key', () => {
            const eitherResponse = mockResponseWithSchema({
              type: 'object',
              properties: {
                surname: { type: 'string', default: 'Kent' },
              },
            });

            it('should use such key', () => {
              assertRight(eitherResponse, response => expect(response.body).toHaveProperty('surname', 'Kent'));
            });
          });

          describe('and the property has nor default, nor example', () => {
            describe('is nullable', () => {
              const eitherResponse = mockResponseWithSchema({
                type: 'object',
                properties: {
                  age: { type: ['number', 'null'] },
                },
              });

              it('should be set to null', () =>
                assertRight(eitherResponse, response => expect(response.body).toHaveProperty('age', null)));
            });

            describe('and is not nullable', () => {
              const eitherResponse = mockResponseWithSchema({
                type: 'object',
                properties: {
                  name: { type: 'string', examples: ['Clark'] },
                  middlename: { type: 'string', examples: ['J'], default: 'JJ' },
                  surname: { type: 'string', default: 'Kent' },
                  age: { type: ['number', 'null'] },
                  email: { type: 'string' },
                  deposit: { type: 'number' },
                  paymentStatus: { type: 'string', enum: ['completed', 'outstanding'] },
                  creditScore: {
                    anyOf: [{ type: 'number', examples: [1958] }, { type: 'string' }],
                  },
                  paymentScore: {
                    oneOf: [{ type: 'string' }, { type: 'number', examples: [1958] }],
                  },
                  walletScore: {
                    allOf: [{ type: 'string' }, { default: 'hello' }],
                  },
                  pet: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', examples: ['Clark'] },
                      middlename: { type: 'string', examples: ['J'], default: 'JJ' },
                    },
                  },
                },
                required: ['name', 'surname', 'age', 'email'],
              });

              assertRight(eitherResponse, response => {
                it('should return the default string', () => expect(response.body).toHaveProperty('email', 'string'));
                it('should return the default number', () => expect(response.body).toHaveProperty('deposit', 0));
                it('should return the first enum value', () =>
                  expect(response.body).toHaveProperty('paymentStatus', 'completed'));
                it('should return the first anyOf value', () =>
                  expect(response.body).toHaveProperty('creditScore', 1958));
                it('should return the first oneOf value', () =>
                  expect(response.body).toHaveProperty('paymentScore', 'string'));
                it('should return the first allOf value', () =>
                  expect(response.body).toHaveProperty('walletScore', 'hello'));
              });
            });
          });
        });
      });
    });
  });
});

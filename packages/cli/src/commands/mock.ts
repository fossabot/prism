import * as signale from 'signale';
import { CommandModule } from 'yargs';
import { createMultiProcessPrism, CreatePrismOptions, createSingleProcessPrism } from '../util/createServer';
import getHttpOperations from '../util/getHttpOperations';

const mockCommand: CommandModule = {
  describe: 'Start a mock server with the given spec file',
  command: 'mock <spec>',
  builder: yargs =>
    yargs
      .positional('spec', {
        description: 'Path to a spec file. Can be both a file or a fetchable resource on the web.',
        type: 'string',
      })
      .middleware(async argv => (argv.operations = await getHttpOperations(argv.spec!)))
      .fail((msg, err) => {
        if (msg) yargs.showHelp();
        else signale.fatal(err.message);

        process.exit(1);
      })
      .options({
        port: {
          alias: 'p',
          description: 'Port that Prism will run on.',
          default: 4010,
          demandOption: true,
          number: true,
        },

        host: {
          alias: 'h',
          description: 'Host that Prism will listen to.',
          default: '127.0.0.1',
          demandOption: true,
          string: true,
        },

        dynamic: {
          alias: 'd',
          description: 'Dynamically generate examples.',
          boolean: true,
          default: false,
        },

        cors: {
          description: 'Enables CORS headers.',
          boolean: true,
          default: true,
        },

        multiprocess: {
          alias: 'm',
          description: 'Forks the http server from the CLI for faster log processing.',
          boolean: true,
          default: process.env.NODE_ENV === 'production',
        },
      }),
  handler: parsedArgs => {
    const { multiprocess, dynamic, port, host, cors, operations } = (parsedArgs as unknown) as CreatePrismOptions & {
      multiprocess: boolean;
    };

    if (multiprocess) {
      return createMultiProcessPrism({ cors, dynamic, port, host, operations });
    }

    return createSingleProcessPrism({ cors, dynamic, port, host, operations });
  },
};

export default mockCommand;

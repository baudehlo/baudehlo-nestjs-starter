import './common/utils/core/instrument'; // Ensure this is imported before any other modules

import * as sourceMapSupport from 'source-map-support';
sourceMapSupport.install();

import { bootstrap } from 'src/common/utils/core/bootstrap-app';

void bootstrap();

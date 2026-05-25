import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(() => {
    controller = new AppController(new AppService());
  });

  it('should return the API greeting', () => {
    expect(controller.getData()).toEqual({ message: 'Hello API' });
  });
});

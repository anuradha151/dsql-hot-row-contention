import { createFunction } from '../../shared/lambda.mjs';

export function createInventoryFunctions(scope, database) {
  return {
    decrementFn: createFunction(
      scope,
      'Decrement',
      'restApi/inventory/decrement',
      database,
      'inventory_writer'
    ),

    decrementSingleQueryFn: createFunction(
      scope,
      'DecrementSingleQuery',
      'restApi/inventory/decrementSingleQuery',
      database,
      'inventory_writer'
    ),

    getStockFn: createFunction(
      scope,
      'GetStock',
      'restApi/inventory/getStock',
      database,
      'inventory_reader'
    ),
  };
}

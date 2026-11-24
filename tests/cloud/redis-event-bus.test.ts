import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Redis } from 'ioredis';
import { RedisEventBus } from '../../src/infra/redis.ts';

function fixture(t: TestContext) {
  t.mock.method(Redis.prototype, 'connect', async () => {});
  const subscriptions: PromiseWithResolvers<void>[] = [];
  let client: Redis;
  const subscribe = t.mock.method(Redis.prototype, 'subscribe', function (this: Redis) {
    client = this;
    const ack = Promise.withResolvers<void>();
    subscriptions.push(ack);
    return ack.promise;
  });
  const unsubscribe = t.mock.method(Redis.prototype, 'unsubscribe', async () => {});
  return {
    bus: new RedisEventBus('redis://127.0.0.1:6379'),
    subscriptions, subscribe, unsubscribe,
    send: () => client.emit('message', 'project', '{"change":1}'),
  };
}

it('waits for the same initial Redis ACK before either project listener is ready', async t => {
  const { bus, subscriptions, subscribe, unsubscribe, send } = fixture(t);
  const first = t.mock.fn(), second = t.mock.fn();
  const a = bus.subscribe('project', first);
  const b = bus.subscribe('project', second);
  let ready = 0;
  void a.then(() => { ready++; });
  void b.then(() => { ready++; });
  await Promise.resolve();
  assert.equal(ready, 0);
  assert.equal(subscribe.mock.callCount(), 1);
  subscriptions[0].resolve();
  const [releaseA, releaseB] = await Promise.all([a, b]);
  send();
  assert.deepEqual(first.mock.calls[0].arguments, [{change: 1}, 'project']);
  assert.equal(second.mock.callCount(), 1);
  await releaseA();
  send();
  assert.equal(first.mock.callCount(), 1);
  assert.equal(second.mock.callCount(), 2);
  assert.equal(unsubscribe.mock.callCount(), 0);
  await Promise.all([releaseB(), releaseB()]);
  assert.equal(unsubscribe.mock.callCount(), 1);
});

it('rejects every waiter on a failed ACK and can subscribe again without leaked listeners', async t => {
  const { bus, subscriptions, send } = fixture(t);
  const abandoned = t.mock.fn(), fresh = t.mock.fn();
  const failed = Promise.allSettled([bus.subscribe('project', abandoned), bus.subscribe('project', abandoned)]);
  const error = new Error('SUBSCRIBE failed');
  subscriptions[0].reject(error);
  const results = await failed;
  assert.deepEqual(results, [{status: 'rejected', reason: error}, {status: 'rejected', reason: error}]);
  const retry = bus.subscribe('project', fresh);
  assert.equal(subscriptions.length, 2);
  subscriptions[1].resolve();
  const release = await retry;
  send();
  assert.equal(abandoned.mock.callCount(), 0);
  assert.equal(fresh.mock.callCount(), 1);
  await release();
});

it('keeps each lease until release and a replacement subscription survives an outstanding unsubscribe', async t => {
  const { bus, subscriptions, unsubscribe, send } = fixture(t);
  const callback = t.mock.fn();
  const a = bus.subscribe('project', callback);
  const b = bus.subscribe('project', callback);
  subscriptions[0].resolve();
  const [releaseA, releaseB] = await Promise.all([a, b]);
  send();
  assert.equal(callback.mock.callCount(), 1);
  await releaseA();
  assert.equal(unsubscribe.mock.callCount(), 0);
  const ack = Promise.withResolvers<void>();
  unsubscribe.mock.mockImplementationOnce(() => ack.promise);
  const leaving = releaseB();
  const next = bus.subscribe('project', callback);
  assert.equal(subscriptions.length, 2);
  ack.resolve();
  await leaving;
  subscriptions[1].resolve();
  const releaseNext = await next;
  await releaseA();
  send();
  assert.equal(callback.mock.callCount(), 2);
  await releaseNext();
  assert.equal(unsubscribe.mock.callCount(), 2);
});

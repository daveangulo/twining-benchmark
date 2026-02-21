import { describe, it, expect, beforeEach } from 'vitest';
import { Database, getDatabase, resetDatabase } from '../../src/utils/database.js';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database();
  });

  describe('insert', () => {
    it('should insert a record', () => {
      const record = db.insert('users', { id: '1', name: 'Alice' });
      expect(record).toEqual({ id: '1', name: 'Alice' });
    });

    it('should throw on duplicate key', () => {
      db.insert('users', { id: '1', name: 'Alice' });
      expect(() => db.insert('users', { id: '1', name: 'Bob' })).toThrow(
        'Duplicate key',
      );
    });
  });

  describe('findById', () => {
    it('should find an existing record', () => {
      db.insert('users', { id: '1', name: 'Alice' });
      const found = db.findById('users', '1');
      expect(found).toEqual({ id: '1', name: 'Alice' });
    });

    it('should return undefined for non-existent record', () => {
      expect(db.findById('users', '999')).toBeUndefined();
    });

    it('should return a copy, not a reference', () => {
      db.insert('users', { id: '1', name: 'Alice' });
      const found = db.findById('users', '1');
      if (found) found['name'] = 'Modified';
      const foundAgain = db.findById('users', '1');
      expect(foundAgain?.['name']).toBe('Alice');
    });
  });

  describe('findAll', () => {
    it('should return all records', () => {
      db.insert('users', { id: '1', name: 'Alice' });
      db.insert('users', { id: '2', name: 'Bob' });
      const all = db.findAll('users');
      expect(all).toHaveLength(2);
    });

    it('should filter with predicate', () => {
      db.insert('users', { id: '1', name: 'Alice', role: 'admin' });
      db.insert('users', { id: '2', name: 'Bob', role: 'member' });
      const admins = db.findAll('users', (r) => r['role'] === 'admin');
      expect(admins).toHaveLength(1);
      expect(admins[0]?.['name']).toBe('Alice');
    });

    it('should return empty array for empty collection', () => {
      expect(db.findAll('empty')).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update an existing record', () => {
      db.insert('users', { id: '1', name: 'Alice' });
      const updated = db.update('users', '1', { name: 'Alice Smith' });
      expect(updated['name']).toBe('Alice Smith');
      expect(updated['id']).toBe('1');
    });

    it('should throw for non-existent record', () => {
      expect(() => db.update('users', '999', { name: 'Ghost' })).toThrow(
        'Record not found',
      );
    });
  });

  describe('delete', () => {
    it('should delete an existing record', () => {
      db.insert('users', { id: '1', name: 'Alice' });
      expect(db.delete('users', '1')).toBe(true);
      expect(db.findById('users', '1')).toBeUndefined();
    });

    it('should return false for non-existent record', () => {
      expect(db.delete('users', '999')).toBe(false);
    });
  });

  describe('count', () => {
    it('should count records', () => {
      db.insert('users', { id: '1', name: 'Alice' });
      db.insert('users', { id: '2', name: 'Bob' });
      expect(db.count('users')).toBe(2);
    });

    it('should return 0 for empty collection', () => {
      expect(db.count('empty')).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all collections', () => {
      db.insert('users', { id: '1', name: 'Alice' });
      db.insert('orders', { id: '1', total: 100 });
      db.clear();
      expect(db.count('users')).toBe(0);
      expect(db.count('orders')).toBe(0);
    });
  });
});

describe('getDatabase / resetDatabase', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('should return a singleton', () => {
    const db1 = getDatabase();
    const db2 = getDatabase();
    expect(db1).toBe(db2);
  });

  it('should reset the singleton', () => {
    const db1 = getDatabase();
    db1.insert('test', { id: '1' });
    resetDatabase();
    const db2 = getDatabase();
    expect(db2.count('test')).toBe(0);
  });
});
